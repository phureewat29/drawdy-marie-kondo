import { uniqBy } from "../lib/fp.ts";
import type { Vec } from "../lib/vectors.ts";
import type { EmbedInput, EmbedTask } from "../shared/protocol.ts";
import type { BoardItem } from "./board.ts";
import type { Ddp } from "./ddp.ts";
import type { EngineClient } from "./engine-client.ts";

export type Embeddings = {
    /**
     * One vector per item, in order; images go to the vision encoder. An item
     * that cannot be read (a broken or missing image) gets null.
     */
    items: (
        task: EmbedTask,
        items: readonly BoardItem[],
        onProgress?: (fraction: number) => void
    ) => Promise<(Vec | null)[]>;
    texts: (task: EmbedTask, texts: readonly string[], onProgress?: (fraction: number) => void) => Promise<Vec[]>;
};

/** The items that could be read, with their vectors. */
export const readable = <T>(items: readonly T[], vectors: readonly (Vec | null)[]): { items: T[]; vectors: Vec[] } => {
    const kept = items.flatMap((item, i) => {
        const vector = vectors[i];
        return vector ? [{ item, vector }] : [];
    });
    return { items: kept.map((k) => k.item), vectors: kept.map((k) => k.vector) };
};

/** About 30 MB of vectors; past it, the least recently used go first. */
const MAX_CACHED = 10_000;

type Entry = { key: string; input: () => Promise<EmbedInput> };

/**
 * Embeddings memoized by task and content, so a search after a grouping, or
 * a second search, only embeds what changed. Vectors still being embedded
 * are shared too: five quick searches embed the board once, not five times.
 * Images look the same whatever the task, so each is embedded only once.
 */
export const createEmbeddings = (deps: { ddp: Ddp; engine: EngineClient }): Embeddings => {
    const { ddp, engine } = deps;
    const cache = new Map<string, Promise<Vec | null>>();

    /** Stores `vector` as the most recently used entry, evicting the oldest. */
    const remember = (key: string, vector: Promise<Vec | null>) => {
        cache.delete(key);
        cache.set(key, vector);
        for (const oldest of cache.keys()) {
            if (cache.size <= MAX_CACHED) break;
            cache.delete(oldest);
        }
    };

    const embed = (task: EmbedTask, entries: readonly Entry[], onProgress?: (fraction: number) => void) => {
        // Every vector this request needs, held here, so evictions while it
        // runs cannot take any away.
        const known = new Map<string, Promise<Vec | null>>();
        entries.forEach((e) => {
            const vector = cache.get(e.key);
            if (vector) known.set(e.key, vector);
        });
        const missing = uniqBy(
            entries.filter((e) => !known.has(e.key)),
            (e) => e.key
        );
        if (missing.length > 0) {
            // An input that cannot be read (an image whose source is gone)
            // becomes null on its own instead of failing the rest.
            const rows = Promise.allSettled(missing.map((e) => e.input())).then(async (settled) => {
                const read = settled.flatMap((r, i) => (r.status === "fulfilled" ? [{ i, input: r.value }] : []));
                const vectors = await engine.embed(task, read.map((r) => r.input), onProgress);
                const byEntry = new Map(read.map((r, n) => [r.i, vectors[n]]));
                return missing.map((_, i) => byEntry.get(i) ?? null);
            });
            missing.forEach((e, i) => {
                const vector = rows.then((r) => r[i]);
                known.set(e.key, vector);
                // A failed request is forgotten, so the next one retries it.
                vector.catch(() => cache.get(e.key) === vector && cache.delete(e.key));
            });
        }
        known.forEach((vector, key) => remember(key, vector));
        return Promise.all(entries.map((e) => known.get(e.key)!));
    };

    const textEntry = (task: EmbedTask, text: string): Entry => ({
        key: `${task}\u0000text\u0000${text}`,
        input: async () => ({ kind: "text", text }),
    });

    const itemEntry = (task: EmbedTask, item: BoardItem): Entry =>
        item.kind === "image"
            ? {
                  key: `image\u0000${item.id}`,
                  input: async () => ({
                      kind: "image",
                      blob: (await ddp.call("command:scene:get-image-source", { drawdyElementId: item.id })).blob,
                  }),
              }
            : textEntry(task, item.text);

    return {
        items: (task, items, onProgress) => embed(task, items.map((item) => itemEntry(task, item)), onProgress),
        texts: async (task, texts, onProgress) => {
            const vectors = await embed(task, texts.map((text) => textEntry(task, text)), onProgress);
            return vectors.map((v) => {
                if (!v) throw new Error("A text could not be embedded");
                return v;
            });
        },
    };
};
