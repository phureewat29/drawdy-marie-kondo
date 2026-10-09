/**
 * Messages between the driver (Drawdy's shared host worker) and Janitor's
 * webview, which hosts the panel UI and the embedding engine.
 *
 * The engine lives in the webview because Drawdy starts drivers from
 * `blob:null` URLs, which are not secure contexts and get no WebGPU, while a
 * webview (a sandboxed `srcdoc` frame of a secure page) does.
 *
 * Messages from the webview are checked at runtime with `webviewToDriver`
 * before the driver acts on them.
 */

import * as g from "../lib/guard.ts";
import type { PanelIcons } from "../webview/panel.ts";

export const MODEL = {
    id: "onnx-community/embeddinggemma-2-ONNX",
    /** Pinned so cached files can never go stale under a repo update. */
    revision: "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
} as const;

/** Loaded at runtime (the marketplace bans npm imports) and hash-checked. */
export const TRANSFORMERS = {
    url: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js",
    sha256: "8d6716d9086f57c30a4bf367dba61b887593573c770c454465e8019b2703e743",
} as const;

export type WebviewConfig = {
    model: typeof MODEL;
    transformers: typeof TRANSFORMERS;
    icons: PanelIcons;
};

/**
 * Text is embedded with EmbeddingGemma 2's task prefixes; images go in raw.
 * See https://huggingface.co/onnx-community/embeddinggemma-2-ONNX#1-task-instruction-prefixes
 */
export type EmbedTask = "query" | "document" | "clustering" | "classification" | "similarity";

export type EmbedInput = { kind: "text"; text: string } | { kind: "image"; blob: Blob };

export const engineState = g.union(
    g.object({ phase: g.literal("idle") }),
    g.object({
        phase: g.literal("loading"),
        /** 0..1 across every file that has reported a size so far. */
        progress: g.number,
        /** Bytes fetched over the network so far (cache hits excluded). */
        downloadedBytes: g.number,
        detail: g.string,
        /** The model file being read, as the model's repository names it. */
        file: g.optional(g.string),
    }),
    g.object({
        phase: g.literal("ready"),
        device: g.oneOf(["webgpu", "wasm"] as const),
        vision: g.boolean,
        adapter: g.nullable(g.string),
        loadMs: g.number,
    }),
    g.object({ phase: g.literal("error"), message: g.string })
);
export type EngineState = g.Infer<typeof engineState>;

export type ItemKind = "note" | "text" | "shape" | "image";

export type SearchHit = {
    id: string;
    kind: ItemKind;
    label: string;
    score: number;
    /** How many notes say exactly this; copies share one hit. */
    copies: number;
};

export type ClusterSummary = { frameId: string; label: string; count: number };

export type Tone = "info" | "success" | "error";

export type DriverToWebview =
    | { type: "theme"; css: string }
    // engine
    | { type: "load"; vision: boolean }
    | { type: "embed"; requestId: number; task: EmbedTask; inputs: EmbedInput[] }
    | { type: "cache-got"; requestId: number; blob: Blob | null }
    | { type: "cache-put-done"; requestId: number }
    // panel
    /** A search's hits, or why it could not run. */
    | { type: "results"; query: string; hits: SearchHit[]; ms: number; error?: string }
    /** Counts, and the one selected element's id when exactly one is selected. */
    | { type: "board"; items: number; selected: number; single?: string }
    | { type: "clusters"; clusters: ClusterSummary[] }
    /** Searches to suggest, taken from the board's own notes. */
    | { type: "suggestions"; queries: string[] }
    | { type: "notice"; text: string; tone: Tone }
    /** Whether the one-time download still has to happen (asked for in the panel). */
    | { type: "setup"; needed: boolean }
    /** What Janitor is doing, with how far along (0..1) when it knows. */
    | { type: "busy"; text: string | null; progress?: number };

export const webviewToDriver = g.union(
    g.object({ type: g.literal("ready") }),
    // engine
    g.object({ type: g.literal("engine-state"), state: engineState }),
    g.object({
        type: g.literal("embedded"),
        requestId: g.number,
        /** Row-major `count × dim`, L2-normalized rows (zeros where `failed`). */
        vectors: g.instanceOf(Float32Array),
        dim: g.number,
        ms: g.number,
        /** Inputs that could not be read, such as a broken image. */
        failed: g.arrayOf(g.number),
    }),
    g.object({ type: g.literal("embed-failed"), requestId: g.number, message: g.string }),
    /** Sent during long requests: progress, and a sign of life. */
    g.object({ type: g.literal("embed-progress"), requestId: g.number, done: g.number, total: g.number }),
    g.object({ type: g.literal("cache-get"), requestId: g.number, key: g.string }),
    g.object({ type: g.literal("cache-put"), requestId: g.number, key: g.string, blob: g.instanceOf(Blob) }),
    g.object({ type: g.literal("log"), level: g.oneOf(["info", "warn", "error"] as const), message: g.string }),
    // panel
    g.object({ type: g.literal("search"), query: g.string }),
    g.object({ type: g.literal("reveal"), id: g.string }),
    g.object({ type: g.literal("hover"), id: g.nullable(g.string) }),
    g.object({ type: g.literal("cluster"), k: g.optional(g.number) }),
    g.object({ type: g.literal("similar") }),
    g.object({ type: g.literal("demo") }),
    /** The user agreed to the one-time download. */
    g.object({ type: g.literal("download") }),
    /** Brings a group into view and selects it, ready for Group or Find similar. */
    g.object({ type: g.literal("go-to-group"), frameId: g.string })
);
export type WebviewToDriver = g.Infer<typeof webviewToDriver>;
