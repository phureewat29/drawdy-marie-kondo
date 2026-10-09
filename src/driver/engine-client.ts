import type { Vec } from "../lib/vectors.ts";
import type { EmbedInput, EmbedTask, EngineState, WebviewToDriver } from "../shared/protocol.ts";
import type { Channel } from "./channel.ts";

/** Where the engine keeps model files between sessions. */
export type ModelFileStore = {
    get: (key: string) => Promise<Blob | null>;
    put: (key: string, blob: Blob) => Promise<void>;
};

export type EngineClient = {
    state: () => EngineState;
    hasVision: () => boolean;
    /** Starts loading the model ahead of the first request. */
    warmUp: (vision?: boolean) => Promise<void>;
    /**
     * One vector per input, or null for an input the engine could not read
     * (a broken image); `onProgress` hears how far along (0..1) long requests are.
     */
    embed: (
        task: EmbedTask,
        inputs: readonly EmbedInput[],
        onProgress?: (fraction: number) => void
    ) => Promise<(Vec | null)[]>;
};

type Pending = {
    count: number;
    resolve: (rows: (Vec | null)[]) => void;
    reject: (err: Error) => void;
    onProgress?: (fraction: number) => void;
};

/**
 * How long the engine may stay silent while it owes an answer. Downloads and
 * long requests report progress far more often, so silence this long means
 * the webview hung or crashed: failing beats blocking every later action.
 */
const SILENCE_LIMIT_MS = 90_000;
const ENGINE_MESSAGES = new Set<WebviewToDriver["type"]>([
    "engine-state",
    "embedded",
    "embed-progress",
    "embed-failed",
    "cache-get",
    "cache-put",
    "log",
]);

/**
 * The driver's handle on the engine running in the webview: turns embed
 * calls into promises and answers the engine's model-file cache requests.
 */
export const createEngineClient = (deps: { channel: Channel; store: ModelFileStore }): EngineClient => {
    const { channel, store } = deps;
    let state: EngineState = { phase: "idle" };
    let sequence = 0;
    const pending = new Map<number, Pending>();

    // The clock starts when the engine first owes an answer; requests made
    // while it already does must not reset it.
    let heardAt = Date.now();
    let watchdog: ReturnType<typeof setInterval> | undefined;
    const watch = () => {
        if (watchdog !== undefined) return;
        heardAt = Date.now();
        watchdog = setInterval(() => {
            if (Date.now() - heardAt <= SILENCE_LIMIT_MS) return;
            const err = new Error("Janitor stopped responding. Reload the page, then try again.");
            [...pending.keys()].forEach((requestId) => settle(requestId)?.reject(err));
        }, 5_000);
    };

    const settle = (requestId: number) => {
        const entry = pending.get(requestId);
        pending.delete(requestId);
        if (pending.size === 0 && watchdog !== undefined) {
            clearInterval(watchdog);
            watchdog = undefined;
        }
        return entry;
    };

    channel.subscribe(async (message) => {
        // Only the engine's own messages show it is alive; the panel's come
        // from the same page even while the GPU is stuck.
        if (ENGINE_MESSAGES.has(message.type)) heardAt = Date.now();
        switch (message.type) {
            case "engine-state":
                state = message.state;
                return;
            case "embedded": {
                const { vectors, dim } = message;
                const entry = settle(message.requestId);
                if (!entry) return;
                const failed = new Set(message.failed);
                // With every input failed there are no rows to measure.
                const count = dim > 0 ? vectors.length / dim : failed.size;
                if (count !== entry.count) {
                    return entry.reject(new Error(`Expected ${entry.count} embeddings, got ${count}`));
                }
                // Copies, so evicting one cached row frees its memory.
                return entry.resolve(
                    Array.from({ length: count }, (_, i) => (failed.has(i) ? null : vectors.slice(i * dim, (i + 1) * dim)))
                );
            }
            case "embed-progress":
                return pending.get(message.requestId)?.onProgress?.(message.done / Math.max(message.total, 1));
            case "embed-failed":
                return settle(message.requestId)?.reject(new Error(message.message));
            case "cache-get": {
                const blob = await store.get(message.key).catch(() => null);
                return channel.post({ type: "cache-got", requestId: message.requestId, blob });
            }
            case "cache-put":
                await store.put(message.key, message.blob).catch(() => undefined);
                return channel.post({ type: "cache-put-done", requestId: message.requestId });
            case "log":
                return console[message.level](`[janitor] ${message.message}`);
            default:
                return;
        }
    });

    return {
        state: () => state,
        hasVision: () => state.phase === "ready" && state.vision,
        warmUp: async (vision = false) => {
            await channel.ensure();
            channel.post({ type: "load", vision });
        },
        embed: async (task, inputs, onProgress) => {
            if (inputs.length === 0) return [];
            await channel.ensure();
            const requestId = sequence++;
            return new Promise<(Vec | null)[]>((resolve, reject) => {
                pending.set(requestId, { count: inputs.length, resolve, reject, onProgress });
                watch();
                channel.post({ type: "embed", requestId, task, inputs: [...inputs] });
            });
        },
    };
};
