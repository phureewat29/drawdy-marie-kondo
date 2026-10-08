import type {
    DriverToWebview,
    EmbedInput,
    EmbedTask,
    EngineState,
    WebviewConfig,
    WebviewToDriver,
} from "../shared/protocol.ts";
import type { Device, Model, Processor, ProgressInfo, Tensor, Transformers } from "./transformers.ts";

export type EngineDeps = {
    config: WebviewConfig;
    post: (message: WebviewToDriver, transfer?: Transferable[]) => void;
    onState: (state: EngineState) => void;
    /**
     * `import()` from the generated script: compiled code may not contain
     * `import()` itself, since compilers rewrite it with helpers that would
     * not exist in the webview.
     */
    importModule: (url: string) => Promise<unknown>;
};

export type Engine = {
    handle: (message: DriverToWebview) => void;
    current: () => EngineState;
};

/**
 * The embedding engine: EmbeddingGemma 2 on transformers.js, on WebGPU when
 * the browser has it and WebAssembly otherwise.
 *
 * Self-contained by design: the driver serializes this function into the
 * webview, so it may only use its parameters, browser globals and what it
 * defines itself.
 */
export const createEngine = ({ config, post, onState, importModule }: EngineDeps): Engine => {
    const PREFIX: Record<EmbedTask, string> = {
        query: "task: search result | query: ",
        document: "title: none | text: ",
        clustering: "task: clustering | query: ",
        classification: "task: classification | query: ",
        similarity: "task: sentence similarity | query: ",
    };
    /** Board text is short; longer text is cut, not split. */
    const MAX_TEXT_TOKENS = 256;
    /**
     * Padded tokens per batch. ONNX Runtime's WebGPU kernels fail past about
     * 2,700 tokens per batch (see the model card), so stay well under it.
     */
    const BATCH_TOKEN_BUDGET = 2048;
    /**
     * Soft tokens per image (70 to 1120; 280 by default). Grouping and search
     * need what a photo shows, not its fine detail: offline, 70 tokens kept
     * the same groups and names as 280 at about a fifth of the cost.
     */
    const IMAGE_TOKENS = 70;
    /** Eight images are 560 soft tokens, well inside the WebGPU limit. */
    const IMAGES_PER_BATCH = 8;
    const PROGRESS_EVERY_MS = 100;
    /** Requests shorter than this report no progress at all. */
    const EMBED_PROGRESS_EVERY_MS = 250;

    type GpuAdapter = { info?: Partial<Record<"vendor" | "architecture", string>> };
    type GpuNavigator = Navigator & { gpu?: { requestAdapter(options?: object): Promise<GpuAdapter | null> } };

    const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

    let state: EngineState = { phase: "idle" };
    const setState = (next: EngineState) => {
        state = next;
        post({ type: "engine-state", state: next });
        onState(next);
    };

    // Model files live in Drawdy's kv-storage, through the driver: this
    // frame's opaque origin has no Cache API or IndexedDB of its own.
    type CacheMessage = Extract<WebviewToDriver, { type: "cache-get" | "cache-put" }>;
    let cacheSeq = 0;
    const cacheReplies = new Map<number, (blob: Blob | null) => void>();
    const cacheRequest = (message: CacheMessage) =>
        new Promise<Blob | null>((resolve) => {
            cacheReplies.set(message.requestId, resolve);
            post(message);
        });
    const cacheGet = (key: string) => cacheRequest({ type: "cache-get", requestId: cacheSeq++, key });
    const cachePut = (key: string, blob: Blob) => cacheRequest({ type: "cache-put", requestId: cacheSeq++, key, blob });
    const cachedKeys = new Set<string>();

    const sha256 = async (blob: Blob) =>
        Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (b) =>
            b.toString(16).padStart(2, "0")
        ).join("");

    /**
     * transformers.js comes from jsDelivr (the marketplace allows no npm
     * imports), must match its pinned SHA-256, and is cached with the model.
     */
    const fetchLibrary = async (): Promise<Transformers> => {
        const { url, sha256: expected } = config.transformers;
        const key = `lib:${url}`;
        const download = async () => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Could not download transformers.js (HTTP ${response.status})`);
            return response.blob();
        };
        const cached = await cacheGet(key);
        const source = cached ?? (await download());
        if ((await sha256(source)) !== expected) {
            throw new Error("transformers.js did not match its pinned SHA-256");
        }
        if (!cached) await cachePut(key, source);
        const lib = (await importModule(URL.createObjectURL(new Blob([source], { type: "text/javascript" })))) as Transformers;
        lib.env.allowLocalModels = false;
        lib.env.useBrowserCache = false;
        lib.env.useCustomCache = true;
        lib.env.customCache = {
            match: async (k) => {
                const blob = await cacheGet(k);
                if (!blob) return undefined;
                cachedKeys.add(k);
                return new Response(blob, { headers: { "content-length": String(blob.size) } });
            },
            put: async (k, response) => {
                await cachePut(k, await response.blob());
            },
        };
        return lib;
    };
    let library: Promise<Transformers> | null = null;
    const loadLibrary = (): Promise<Transformers> => {
        library ??= fetchLibrary().catch((err: unknown) => {
            library = null;
            throw err;
        });
        return library;
    };

    const detectDevice = async (): Promise<{ device: Device; adapter: string | null }> => {
        const gpu = (navigator as GpuNavigator).gpu;
        const adapter = await gpu?.requestAdapter({ powerPreference: "high-performance" }).catch(() => null);
        if (!adapter) return { device: "wasm", adapter: null };
        const name = [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(" ");
        return { device: "webgpu", adapter: name || "WebGPU" };
    };

    /**
     * Byte progress across a load's files, at most every PROGRESS_EVERY_MS:
     * transformers.js reports thousands of chunks, and each report crosses to
     * the driver. Cache reads come through the same callback (without byte
     * counts), so cached files count as loading, not downloading.
     */
    const progressTracker = () => {
        const files = new Map<string, { loaded: number; total: number }>();
        let downloadedBytes = 0;
        let reportedAt = 0;
        return (info: ProgressInfo) => {
            if (!("file" in info)) return;
            const bytes = (n: number | undefined) => (Number.isFinite(n) ? (n as number) : 0);
            const loaded = bytes(info.loaded);
            const total = bytes(info.total);
            const fromCache = [...cachedKeys].some((k) => k.endsWith(`/${info.file}`));
            const before = files.get(info.file);
            if (!fromCache) downloadedBytes += Math.max(0, loaded - (before?.loaded ?? 0));
            // "Done" events carry no sizes: a finished file keeps its own.
            if (total > 0 || !before) files.set(info.file, { loaded, total });
            // Cached reads carry no byte counts, so "a file just finished" is
            // the only reason to skip the throttle.
            const finished = total > 0 && loaded >= total;
            const now = performance.now();
            if (!finished && now - reportedAt < PROGRESS_EVERY_MS) return;
            reportedAt = now;
            const all = [...files.values()];
            const sumTotal = all.reduce((s, f) => s + f.total, 0);
            setState({
                phase: "loading",
                progress: sumTotal > 0 ? all.reduce((s, f) => s + f.loaded, 0) / sumTotal : 0,
                downloadedBytes,
                detail: fromCache ? "Loading from this device" : "Downloading",
                file: info.file,
            });
        };
    };

    let model: Model | null = null;
    let processor: Processor | null = null;
    let loadedVision: boolean | null = null;

    /**
     * Loads the text model, plus the vision encoder when asked; the audio
     * encoder never loads. Asking for vision after a text-only load swaps in
     * a model with both, whose text weights come back from the cache.
     */
    const load = async (vision: boolean): Promise<void> => {
        if (loadedVision === true || loadedVision === vision) return;
        const started = performance.now();
        setState({ phase: "loading", progress: 0, downloadedBytes: 0, detail: "Starting" });
        try {
            const lib = await loadLibrary();
            const progress_callback = progressTracker();
            const { id, revision } = config.model;
            const { device: preferred, adapter } = await detectDevice();
            const pretrained = await lib.AutoConfig.from_pretrained(id, { revision });
            const modelConfig = { ...pretrained, audio_config: null, ...(vision ? {} : { vision_config: null }) };
            processor ??= await lib.AutoProcessor.from_pretrained(id, { revision, progress_callback });
            processor.image_processor.max_soft_tokens = IMAGE_TOKENS;
            const fromPretrained = (device: Device) =>
                lib.AutoModel.from_pretrained(id, { config: modelConfig, revision, device, dtype: "q4", progress_callback });
            const loaded = await fromPretrained(preferred)
                .then((m) => ({ m, device: preferred }))
                .catch(async (err: unknown) => {
                    if (preferred !== "webgpu") throw err;
                    post({ type: "log", level: "warn", message: `WebGPU failed (${describe(err)}), using WebAssembly` });
                    return { m: await fromPretrained("wasm"), device: "wasm" as const };
                });
            await model?.dispose();
            model = loaded.m;
            loadedVision = vision;
            setState({
                phase: "ready",
                device: loaded.device,
                vision,
                adapter: loaded.device === "webgpu" ? adapter : null,
                loadMs: Math.round(performance.now() - started),
            });
        } catch (err) {
            setState({ phase: "error", message: describe(err) });
            throw err;
        }
    };

    /** Copies `rows × dim` embeddings into `out` at `targets`, normalized. */
    const writeRows = (embedding: Tensor, targets: readonly number[], out: Float32Array[]) => {
        const [rows, dim] = embedding.dims;
        for (let r = 0; r < rows; r++) {
            const row = Float32Array.from({ length: dim }, (_, c) => Number(embedding.data[r * dim + c]));
            const norm = Math.sqrt(row.reduce((s, x) => s + x * x, 0)) || 1;
            out[targets[r]] = row.map((x) => x / norm);
        }
    };

    /** Reports a request's progress, at most every EMBED_PROGRESS_EVERY_MS. */
    const progressReporter = (requestId: number, total: number) => {
        let done = 0;
        let reportedAt = performance.now();
        return (count: number) => {
            done += count;
            const now = performance.now();
            if (done >= total || now - reportedAt < EMBED_PROGRESS_EVERY_MS) return;
            reportedAt = now;
            post({ type: "embed-progress", requestId, done, total });
        };
    };

    const embedTexts = async (
        task: EmbedTask,
        items: { index: number; text: string }[],
        out: Float32Array[],
        advance: (count: number) => void
    ) => {
        const tokenizer = processor!.tokenizer;
        // Similar lengths batch together so little is padding; each batch
        // fills up to the token budget.
        const prepared = items
            .map(({ index, text }) => {
                const prompt = PREFIX[task] + text;
                return { index, prompt, length: Math.min(tokenizer.encode(prompt).length, MAX_TEXT_TOKENS) };
            })
            .toSorted((a, b) => a.length - b.length);
        const batches = prepared.reduce<(typeof prepared)[]>((acc, item) => {
            const last = acc.at(-1);
            return last && (last.length + 1) * item.length <= BATCH_TOKEN_BUDGET
                ? [...acc.slice(0, -1), [...last, item]]
                : [...acc, [item]];
        }, []);
        for (const batch of batches) {
            const inputs = tokenizer(
                batch.map((b) => b.prompt),
                { padding: true, truncation: true, max_length: MAX_TEXT_TOKENS }
            );
            const { sentence_embedding } = await model!(inputs);
            writeRows(sentence_embedding, batch.map((b) => b.index), out);
            advance(batch.length);
        }
    };

    /**
     * Embeds images in batches. An image that cannot be decoded or embedded
     * is reported in `failed` rather than failing the others.
     */
    const embedImages = async (
        lib: Transformers,
        items: { index: number; blob: Blob }[],
        out: Float32Array[],
        failed: number[],
        advance: (count: number) => void
    ) => {
        // One list per input, so each image becomes its own embedding.
        const run = async (batch: { index: number; image: unknown }[]) => {
            const { sentence_embedding } = await model!(await processor!(null, batch.map((b) => [b.image])));
            writeRows(sentence_embedding, batch.map((b) => b.index), out);
        };
        for (let i = 0; i < items.length; i += IMAGES_PER_BATCH) {
            const slice = items.slice(i, i + IMAGES_PER_BATCH);
            const decoded = await Promise.all(
                slice.map(async (b) => ({ index: b.index, image: await lib.RawImage.fromBlob(b.blob).catch(() => null) }))
            );
            decoded.filter((d) => d.image === null).forEach((d) => failed.push(d.index));
            const batch = decoded.filter((d) => d.image !== null);
            if (batch.length > 0) {
                // If the batch fails, find the culprit one image at a time.
                await run(batch).catch(async () => {
                    for (const single of batch) await run([single]).catch(() => failed.push(single.index));
                });
            }
            advance(slice.length);
        }
    };

    const embed = async (requestId: number, task: EmbedTask, inputs: readonly EmbedInput[]) => {
        const started = performance.now();
        const texts = inputs.flatMap((input, index) => (input.kind === "text" ? [{ index, text: input.text }] : []));
        const images = inputs.flatMap((input, index) => (input.kind === "image" ? [{ index, blob: input.blob }] : []));
        await load(images.length > 0);
        const rows = new Array<Float32Array>(inputs.length);
        const failed: number[] = [];
        const advance = progressReporter(requestId, inputs.length);
        if (texts.length > 0) await embedTexts(task, texts, rows, advance);
        if (images.length > 0) await embedImages(await loadLibrary(), images, rows, failed, advance);
        const dim = rows.find((row) => row !== undefined)?.length ?? 0;
        const vectors = new Float32Array(rows.length * dim);
        for (let i = 0; i < inputs.length; i++) {
            if (rows[i]) vectors.set(rows[i], i * dim);
            else if (!failed.includes(i)) throw new Error(`No embedding for input ${i}`);
        }
        post(
            { type: "embedded", requestId, vectors, dim, ms: Math.round(performance.now() - started), failed },
            [vectors.buffer]
        );
    };

    // One request at a time: sessions are serialized anyway, and this keeps a
    // vision upgrade from racing a text batch.
    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = (job: () => Promise<unknown>) => {
        queue = queue.then(job).catch(() => undefined);
    };

    const settle = (requestId: number, blob: Blob | null) => {
        cacheReplies.get(requestId)?.(blob);
        cacheReplies.delete(requestId);
    };

    const handle = (message: DriverToWebview) => {
        switch (message.type) {
            case "cache-got":
                return settle(message.requestId, message.blob);
            case "cache-put-done":
                return settle(message.requestId, null);
            case "load":
                return enqueue(() => load(message.vision));
            case "embed":
                return enqueue(() =>
                    embed(message.requestId, message.task, message.inputs).catch((err: unknown) =>
                        post({ type: "embed-failed", requestId: message.requestId, message: describe(err) })
                    )
                );
            default:
                return;
        }
    };

    return { handle, current: () => state };
};
