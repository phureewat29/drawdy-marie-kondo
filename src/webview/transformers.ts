/**
 * The slice of the transformers.js 4 API Sensemaker uses. The library itself
 * is loaded at runtime (see engine.ts), so only these types are compiled in.
 */

export type Tensor = { data: ArrayLike<number>; dims: number[] };

/** Byte counts are missing when a file is read from a cache. */
export type ProgressInfo =
    | { status: "progress"; file: string; loaded?: number; total?: number; progress?: number }
    | { status: string };

export type Device = "webgpu" | "wasm";

export type PretrainedOptions = {
    revision?: string;
    progress_callback?: (info: ProgressInfo) => void;
    config?: Record<string, unknown>;
    device?: Device;
    dtype?: "q4" | "q8" | "fp16" | "fp32";
};

export type TokenizerOptions = { padding: boolean; truncation: boolean; max_length: number };

export type Tokenizer = {
    (texts: string[], options: TokenizerOptions): Record<string, unknown>;
    encode(text: string): number[];
};

export type Processor = {
    (text: null, images: unknown[][]): Promise<Record<string, unknown>>;
    tokenizer: Tokenizer;
    /** Vision settings: `max_soft_tokens` is the per-image token budget (70 to 1120). */
    image_processor: { max_soft_tokens: number };
};

export type Model = {
    (inputs: Record<string, unknown>): Promise<{ sentence_embedding: Tensor }>;
    dispose(): Promise<unknown>;
};

/** What transformers.js expects of `env.customCache` (a Web Cache subset). */
export type CustomCache = {
    match(key: string): Promise<Response | undefined>;
    put(key: string, response: Response): Promise<void>;
};

export type Transformers = {
    env: {
        allowLocalModels: boolean;
        useBrowserCache: boolean;
        useCustomCache: boolean;
        customCache: CustomCache | null;
    };
    AutoConfig: { from_pretrained(id: string, options?: PretrainedOptions): Promise<Record<string, unknown>> };
    AutoProcessor: { from_pretrained(id: string, options?: PretrainedOptions): Promise<Processor> };
    AutoModel: { from_pretrained(id: string, options?: PretrainedOptions): Promise<Model> };
    RawImage: { fromBlob(blob: Blob): Promise<unknown> };
};
