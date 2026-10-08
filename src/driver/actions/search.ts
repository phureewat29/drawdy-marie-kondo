import { union } from "../../lib/layout.ts";
import { dot } from "../../lib/vectors.ts";
import { describeItem, noteKey, type BoardItem } from "../board.ts";
import { readable } from "../embeddings.ts";
import { focus } from "../camera.ts";
import type { Context } from "../context.ts";
import { explain } from "../ddp.ts";

const MAX_HITS = 12;

export type Search = {
    search: (query: string) => Promise<void>;
    /** Runs the last search again: the board changed under it. */
    refresh: () => Promise<void>;
    hover: (id: string | null) => Promise<void>;
    reveal: (id: string) => Promise<void>;
};

/**
 * Search by meaning. Board items are embedded once as documents (and kept
 * in the embedding cache); each query is embedded as a search query, the
 * asymmetric pairing EmbeddingGemma is trained for.
 */
export const createSearch = (ctx: Context): Search => {
    let generation = 0;
    let lastQuery: string | null = null;
    /** Each hit's copies, by the id the panel knows it by. */
    let shown = new Map<string, BoardItem[]>();

    const search = async (query: string) => {
        lastQuery = query;
        const mine = ++generation;
        const started = Date.now();
        try {
            await rank(query, mine, started);
        } catch (err) {
            // The panel waits for an answer either way.
            if (mine !== generation) return;
            ctx.tell({ type: "results", query, hits: [], ms: Date.now() - started, error: explain(err) });
        }
    };

    const rank = async (query: string, mine: number, started: number) => {
        const board = (await ctx.board.items()).filter((i) => i.kind !== "image" || ctx.engine.hasVision());
        // Items that cannot be read (a broken image) are left out.
        const { items, vectors: documents } = readable(board, await ctx.embeddings.items("document", board));
        const [q] = await ctx.embeddings.texts("query", [query]);
        // A newer query superseded this one while it was embedding.
        if (mine !== generation || !q) return;
        const scores = documents.map((d) => dot(q, d));
        // Copies of one note (pasted twice, the same feedback twice) share a hit.
        const byNote = new Map<string, number[]>();
        items.forEach((item, i) => {
            const key = noteKey(item);
            byNote.set(key, [...(byNote.get(key) ?? []), i]);
        });
        const ranked = [...byNote.values()]
            .map((members) => ({ members, score: Math.max(...members.map((i) => scores[i])) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_HITS);
        shown = new Map(ranked.map(({ members }) => [items[members[0]].id, members.map((i) => items[i])]));
        ctx.tell({
            type: "results",
            query,
            hits: ranked.map(({ members, score }) => {
                const first = items[members[0]];
                return { id: first.id, kind: first.kind, label: describeItem(first), score, copies: members.length };
            }),
            ms: Date.now() - started,
        });
    };

    const hover = async (id: string | null) => {
        const copies = (id && shown.get(id)) || [];
        await (copies.length > 0 ? ctx.highlight.show(copies.map((c) => ({ rect: c.rect }))) : ctx.highlight.clear());
    };

    /** Brings a hit's notes, every copy of it, into view and selects them. */
    const reveal = async (id: string) => {
        const copies = shown.get(id) ?? [];
        if (copies.length > 0) await focus(ctx.ddp, union(copies.map((c) => c.rect)), { durationMs: 500 });
        await ctx.ddp.tryCall("command:scene:set-selection", {
            drawdyElementIds: copies.length > 0 ? copies.map((c) => c.id) : [id],
        });
        await hover(id);
    };

    const refresh = async () => {
        if (lastQuery) await search(lastQuery);
    };

    return { search, refresh, hover, reveal };
};
