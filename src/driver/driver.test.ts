import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { Vec } from "../lib/vectors.ts";
import type { DriverToWebview, EmbedInput, WebviewToDriver } from "../shared/protocol.ts";
import { createBoardCache, framesLeftEmpty, MARK, readBoardSummary, type BoardItem } from "./board.ts";
import { focus } from "./camera.ts";
import type { Channel } from "./channel.ts";
import type { Ddp } from "./ddp.ts";
import { clusterSelection } from "./actions/cluster.ts";
import { createSearch } from "./actions/search.ts";
import type { Context } from "./context.ts";
import { createEmbeddings } from "./embeddings.ts";
import { createEngineClient, type EngineClient } from "./engine-client.ts";
import { groupFrame } from "./frame.ts";
import { kvSetupFlag } from "./model-store.ts";
import { glide } from "./motion.ts";
import { MODEL } from "../shared/protocol.ts";

type Handler = (req: any) => unknown;

/** A stand-in for Drawdy's host: answers the commands it is given handlers for. */
const fakeDdp = (handlers: Record<string, Handler>) => {
    const calls: { type: string; req: any }[] = [];
    const call = async (type: string, req?: unknown) => {
        calls.push({ type, req });
        const handler = handlers[type];
        if (!handler) throw new Error(`unexpected command ${type}`);
        return handler(req);
    };
    const ddp = { driverId: "test", call, tryCall: (type: string, req?: unknown) => call(type, req).catch(() => null) };
    return { ddp: ddp as unknown as Ddp, calls };
};

const note = (id: string, extra: Partial<BoardItem> = {}): BoardItem => ({
    id,
    kind: "note",
    text: id,
    rect: { x: 0, y: 0, width: 100, height: 100 },
    locked: false,
    frameId: null,
    ...extra,
});

const vector = (seed: number): Vec => Float32Array.from([seed, 1]);

afterEach(() => {
    jest.useRealTimers();
});

describe("embeddings", () => {
    const fakeEngine = () => {
        const embed = jest.fn(async (_task: unknown, inputs: readonly EmbedInput[]) => inputs.map((_, i) => vector(i)));
        return { engine: { embed } as unknown as EngineClient, embed };
    };

    it("embeds a text once, even when asked twice at the same time", async () => {
        const { engine, embed } = fakeEngine();
        const embeddings = createEmbeddings({ ddp: fakeDdp({}).ddp, engine });
        const [a, b] = await Promise.all([embeddings.texts("query", ["fees"]), embeddings.texts("query", ["fees"])]);
        expect(embed).toHaveBeenCalledTimes(1);
        expect(a[0]).toBe(b[0]);
    });

    it("keeps vectors per task", async () => {
        const { engine, embed } = fakeEngine();
        const embeddings = createEmbeddings({ ddp: fakeDdp({}).ddp, engine });
        await embeddings.texts("query", ["fees"]);
        await embeddings.texts("document", ["fees"]);
        await embeddings.texts("query", ["fees"]);
        expect(embed).toHaveBeenCalledTimes(2);
    });

    it("retries what failed instead of caching the failure", async () => {
        const { engine, embed } = fakeEngine();
        embed.mockRejectedValueOnce(new Error("GPU lost"));
        const embeddings = createEmbeddings({ ddp: fakeDdp({}).ddp, engine });
        await expect(embeddings.texts("query", ["fees"])).rejects.toThrow("GPU lost");
        await expect(embeddings.texts("query", ["fees"])).resolves.toHaveLength(1);
        expect(embed).toHaveBeenCalledTimes(2);
    });

    it("embeds an image once whatever the task, and gives null for one it cannot read", async () => {
        const { engine, embed } = fakeEngine();
        const { ddp } = fakeDdp({
            "command:scene:get-image-source": (req) => {
                if (req.drawdyElementId === "broken") throw new Error("404");
                return { blob: new Blob(["png"]) };
            },
        });
        const embeddings = createEmbeddings({ ddp, engine });
        const photo = note("photo", { kind: "image", text: "" });
        const broken = note("broken", { kind: "image", text: "" });
        const [a, b, c] = await embeddings.items("clustering", [photo, broken, note("n1")]);
        expect(a).not.toBeNull();
        expect(b).toBeNull();
        expect(c).not.toBeNull();
        await embeddings.items("document", [photo]);
        // The first call embedded the photo and the note; the image is not embedded again.
        expect(embed).toHaveBeenCalledTimes(1);
    });

    it("evicts the least recently used vectors, not everything", async () => {
        const { engine, embed } = fakeEngine();
        const embeddings = createEmbeddings({ ddp: fakeDdp({}).ddp, engine });
        const texts = Array.from({ length: 10_001 }, (_, i) => `note ${i}`);
        await embeddings.texts("document", texts);
        embed.mockClear();
        await embeddings.texts("document", ["note 10000", "note 1"]);
        expect(embed).not.toHaveBeenCalled();
        await embeddings.texts("document", ["note 0"]);
        expect(embed).toHaveBeenCalledTimes(1);
    });
});

describe("search", () => {
    it("shows copies of one note as one hit, and reveals every copy", async () => {
        const at = (x: number) => ({ x, y: 0, width: 100, height: 100 });
        const items = [
            note("a", { text: "Delivery is late", rect: at(0) }),
            note("b", { text: "delivery is  LATE", rect: at(500) }),
            note("c", { text: "Fees are high", rect: at(900) }),
        ];
        const told: DriverToWebview[] = [];
        const { ddp, calls } = fakeDdp({
            "command:dom:window-size": () => ({ width: 1440, height: 900 }),
            "command:camera:fly-to-rect": () => undefined,
            "command:scene:set-selection": () => undefined,
        });
        const shown: unknown[] = [];
        const ctx = {
            ddp,
            board: { items: async () => items, invalidate: () => undefined },
            engine: { hasVision: () => false },
            embeddings: {
                items: async (_task: string, list: readonly BoardItem[]) =>
                    list.map((i) => (i.text.toLowerCase().includes("late") ? vector(1) : vector(0))),
                texts: async () => [vector(1)],
            },
            highlight: { show: async (marks: unknown[]) => void shown.push(marks), clear: async () => undefined },
            tell: (message: DriverToWebview) => void told.push(message),
        } as unknown as Context;
        const search = createSearch(ctx);
        await search.search("late");
        const results = told.find((m) => m.type === "results") as Extract<DriverToWebview, { type: "results" }>;
        expect(results.hits.map((h) => [h.id, h.copies])).toEqual([
            ["a", 2],
            ["c", 1],
        ]);
        await search.reveal("a");
        const selection = calls.find((c) => c.type === "command:scene:set-selection")!;
        expect(selection.req.drawdyElementIds).toEqual(["a", "b"]);
        expect(shown.at(-1)).toHaveLength(2);
    });
});

describe("engine client", () => {
    const fakeChannel = () => {
        const handlers: ((message: WebviewToDriver) => void)[] = [];
        const posted: DriverToWebview[] = [];
        const channel = {
            id: "panel",
            isReady: () => true,
            open: async () => undefined,
            ensure: async () => undefined,
            post: (message: DriverToWebview) => void posted.push(message),
            receive: () => undefined,
            subscribe: (handler: (message: WebviewToDriver) => void) => void handlers.push(handler),
            pushTheme: () => undefined,
        } satisfies Channel;
        const reply = (message: WebviewToDriver) => handlers.forEach((handler) => handler(message));
        const lastEmbed = () => posted.filter((m) => m.type === "embed").at(-1) as Extract<DriverToWebview, { type: "embed" }>;
        return { channel, reply, lastEmbed };
    };
    const store = { get: async () => null, put: async () => undefined };
    const texts = (...values: string[]): EmbedInput[] => values.map((text) => ({ kind: "text", text }));
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it("resolves rows and reports progress along the way", async () => {
        const { channel, reply, lastEmbed } = fakeChannel();
        const client = createEngineClient({ channel, store });
        const progress = jest.fn();
        const result = client.embed("document", texts("a", "b"), progress);
        await flush();
        const { requestId } = lastEmbed();
        reply({ type: "embed-progress", requestId, done: 1, total: 2 });
        reply({ type: "embedded", requestId, vectors: Float32Array.from([1, 0, 0, 1]), dim: 2, ms: 3, failed: [] });
        expect(progress).toHaveBeenCalledWith(0.5);
        expect((await result).map((row) => [...row!])).toEqual([
            [1, 0],
            [0, 1],
        ]);
    });

    it("gives null for inputs the engine could not read, and the rest as usual", async () => {
        const { channel, reply, lastEmbed } = fakeChannel();
        const client = createEngineClient({ channel, store });
        const result = client.embed("document", texts("a", "b"));
        await flush();
        reply({ type: "embedded", requestId: lastEmbed().requestId, vectors: Float32Array.from([0, 0, 0, 1]), dim: 2, ms: 3, failed: [0] });
        expect((await result).map((row) => (row ? [...row] : null))).toEqual([null, [0, 1]]);
    });

    it("handles a request whose every input failed", async () => {
        const { channel, reply, lastEmbed } = fakeChannel();
        const client = createEngineClient({ channel, store });
        const result = client.embed("document", texts("a", "b"));
        await flush();
        reply({ type: "embedded", requestId: lastEmbed().requestId, vectors: new Float32Array(0), dim: 0, ms: 3, failed: [0, 1] });
        expect(await result).toEqual([null, null]);
    });

    it("rejects an answer with the wrong number of rows", async () => {
        const { channel, reply, lastEmbed } = fakeChannel();
        const client = createEngineClient({ channel, store });
        const result = client.embed("document", texts("a", "b"));
        await flush();
        reply({ type: "embedded", requestId: lastEmbed().requestId, vectors: Float32Array.from([1, 0]), dim: 2, ms: 3, failed: [] });
        await expect(result).rejects.toThrow("Expected 2 embeddings, got 1");
    });

    it("gives up on an engine that has gone silent, instead of blocking forever", async () => {
        jest.useFakeTimers();
        const { channel, reply } = fakeChannel();
        const client = createEngineClient({ channel, store });
        const result = client.embed("document", texts("a"));
        const settled = jest.fn();
        result.then(settled, settled);
        await Promise.resolve();
        await Promise.resolve();
        // Neither panel chatter nor more requests are a sign of life.
        reply({ type: "hover", id: null });
        jest.advanceTimersByTime(60_000);
        const later = client.embed("document", texts("b"));
        later.catch(() => undefined);
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        jest.advanceTimersByTime(40_000);
        await expect(result).rejects.toThrow("stopped responding");
        await expect(later).rejects.toThrow("stopped responding");
    });
});

describe("glide", () => {
    const scene = (positions: Record<string, { x: number; y: number }>, failPreview = false) =>
        fakeDdp({
            "command:scene:get-drawdy-elements": (req) => ({
                drawdyElements: req.drawdyElementIds.filter((id: string) => positions[id]).map((id: string) => ({ id, ...positions[id] })),
            }),
            "command:scene:begin-preview": (req) => ({ began: req.drawdyElementIds }),
            "command:scene:preview-transforms": () => {
                if (failPreview) throw new Error("host went away");
                return undefined;
            },
            "command:scene:end-preview": () => ({ committed: 0 }),
        });
    const types = (calls: { type: string }[]) => calls.map((c) => c.type.replace("command:scene:", ""));

    it("animates from where elements are now, then lands them as the preview ends", async () => {
        const { ddp, calls } = scene({ a: { x: 50, y: 0 } });
        const land = jest.fn(async () => undefined);
        await glide(
            ddp,
            [
                { id: "a", to: { x: 100, y: 0 }, delayMs: 0 },
                { id: "gone", to: { x: 100, y: 0 }, delayMs: 0 },
            ],
            land,
            1
        );
        const previews = calls.filter((c) => c.type === "command:scene:preview-transforms");
        expect(previews.at(-1)!.req.previews).toEqual([
            { drawdyElementId: "a", transform: { x: 50, y: 0, scale: 1, rotation: 0 } },
        ]);
        // Nothing is committed by the preview itself: `land` writes the result.
        expect(calls.find((c) => c.type === "command:scene:end-preview")!.req.commits).toEqual([]);
        expect(types(calls).at(-1)).toBe("end-preview");
        expect(land).toHaveBeenCalledTimes(1);
    });

    it("drops the preview and lands nothing when the animation fails", async () => {
        const { ddp, calls } = scene({ a: { x: 0, y: 0 } }, true);
        const land = jest.fn(async () => undefined);
        await expect(glide(ddp, [{ id: "a", to: { x: 100, y: 0 }, delayMs: 0 }], land, 1)).rejects.toThrow("host went away");
        expect(calls.find((c) => c.type === "command:scene:end-preview")!.req.commits).toEqual([]);
        expect(land).not.toHaveBeenCalled();
    });
});

describe("focus", () => {
    const flyTo = async (width: number, height: number, left = 0) => {
        const { ddp, calls } = fakeDdp({
            "command:dom:window-size": () => ({ width, height }),
            "command:camera:fly-to-rect": () => undefined,
        });
        await focus(ddp, { x: 0, y: 0, width: 800, height: 600 }, { left });
        return calls.find((c) => c.type === "command:camera:fly-to-rect")!.req.rect;
    };

    it("leaves room for Drawdy's panels on a large window", async () => {
        const rect = await flyTo(1440, 900, 270);
        expect(rect.x).toBeLessThan(0);
        expect(rect.width).toBeGreaterThan(800);
    });

    it.each([
        [706, 800, 270],
        [683, 800, 270],
        [420, 300, 0],
        [80, 60, 270],
    ])("stays finite and positive on a %ix%i window", async (width, height, left) => {
        const rect = await flyTo(width, height, left);
        for (const value of Object.values(rect) as number[]) expect(Number.isFinite(value)).toBe(true);
        expect(rect.width).toBeGreaterThan(800);
        expect(rect.height).toBeGreaterThan(600);
    });
});

describe("setup flag", () => {
    const storage = (initial?: Record<string, unknown>) => {
        let stored = initial;
        const { ddp, calls } = fakeDdp({
            "command:kv-storage:get": () => ({ got: stored }),
            "command:kv-storage:set": (req) => {
                stored = req.payload;
                return undefined;
            },
        });
        return { flag: kvSetupFlag(ddp), calls };
    };

    it("is done only after the current model was set up", async () => {
        const { flag } = storage();
        expect(await flag.isDone()).toBe(false);
        await flag.markDone();
        expect(await flag.isDone()).toBe(true);
    });

    it("asks again for a new model revision", async () => {
        expect(await storage({ revision: "older" }).flag.isDone()).toBe(false);
        expect(await storage({ revision: MODEL.revision }).flag.isDone()).toBe(true);
    });

    it("counts as not done when storage is unavailable", async () => {
        const flag = kvSetupFlag(fakeDdp({}).ddp);
        expect(await flag.isDone()).toBe(false);
        await expect(flag.markDone()).resolves.toBeUndefined();
    });
});

describe("board", () => {
    it("reads the board once until it changes", async () => {
        const { ddp, calls } = fakeDdp({
            "command:scene:get-drawdy-elements": () => ({
                drawdyElements: [{ id: "a", type: "text", text: "hello", x: 0, y: 0, width: 10, height: 10 }],
            }),
        });
        const board = createBoardCache(ddp);
        expect(await board.items()).toHaveLength(1);
        await board.items();
        expect(calls).toHaveLength(1);
        board.invalidate();
        await board.items();
        expect(calls).toHaveLength(2);
    });

    it("lists the board's groups in reading order, with counts, leaving out empty ones", async () => {
        const group = (id: string, label: string) => ({ id, type: "frame", meta: { [MARK]: "frame", label } });
        const { ddp, calls } = fakeDdp({
            "command:scene:get-drawdy-elements": () => ({
                drawdyElements: [
                    group("right", "Delivery"),
                    group("left", "Fees"),
                    group("below", "Cats"),
                    group("emptied", "Gone"),
                    { id: "user", type: "frame", meta: {} },
                    { id: "a", type: "text", text: "fees", frameId: "left" },
                    { id: "b", type: "image", frameId: "right" },
                    { id: "c", type: "text", text: "late", frameId: "right" },
                    { id: "d", type: "image", frameId: "below" },
                    { id: "e", type: "text", text: "loose" },
                    { id: "f", type: "text", text: "in a user frame", frameId: "user" },
                    { id: "blank", type: "text", text: " ", frameId: "emptied" },
                ],
            }),
            "command:scene:element-rects": (req) => ({
                rects: req.drawdyElementIds.map((id: string) => ({
                    drawdyElementId: id,
                    rect: { x: id === "right" ? 600 : 0, y: id === "below" ? 500 : 0, width: 500, height: 400 },
                })),
            }),
        });
        const summary = await readBoardSummary(ddp);
        expect(summary.items).toBe(6);
        // The notes' text, for search suggestions; images have none.
        expect(summary.texts).toEqual(["fees", "late", "loose", "in a user frame"]);
        expect(summary.groups).toEqual([
            { frameId: "left", label: "Fees", count: 1 },
            { frameId: "right", label: "Delivery", count: 2 },
            { frameId: "below", label: "Cats", count: 1 },
        ]);
        // Only the groups are measured, not every element on the board.
        expect(calls[0].req.properties).not.toContain("x");
        expect(calls[1].req.drawdyElementIds).toEqual(["right", "left", "below"]);
    });

    it("finds the group frames a regroup would leave empty", async () => {
        const frame = (id: string, mine: boolean) => ({
            id,
            x: 0,
            y: 0,
            width: 500,
            height: 400,
            meta: mine ? { [MARK]: "frame", label: `Group ${id}` } : {},
        });
        const frames = { f1: frame("f1", true), f2: frame("f2", true), user: frame("user", false) };
        const children = [
            { id: "a", frameId: "f1" },
            { id: "b", frameId: "f1" },
            { id: "c", frameId: "f2" },
            { id: "kept", frameId: "f2" },
            { id: "d", frameId: "user" },
        ];
        const { ddp } = fakeDdp({
            "command:scene:get-drawdy-elements": (req) =>
                req.drawdyElementIds
                    ? { drawdyElements: req.drawdyElementIds.map((id: keyof typeof frames) => frames[id]) }
                    : { drawdyElements: [...children, ...Object.values(frames)] },
        });
        const moving = ["a", "b", "c", "d"].map((id) => note(id, { frameId: children.find((c) => c.id === id)!.frameId }));
        expect(await framesLeftEmpty(ddp, moving)).toEqual([
            { id: "f1", rect: { x: 0, y: 0, width: 500, height: 400 }, label: "Group f1" },
        ]);
    });
});

describe("grouping into the user's own groups", () => {
    /** Six notes on a board with a security, a speed and an unrelated theme. */
    const board = () => {
        const notes = [
            ["s1", "Passwords leaked in a public commit", [1, 0.1, 0]],
            ["s2", "Turn on two-factor login", [1, 0, 0.1]],
            ["p1", "The dashboard is slow", [0.1, 1, 0]],
            ["p2", "Search lags under load", [0, 1, 0.1]],
            ["o1", "Who took my charger?", [0, 0.1, 1]],
            ["o2", "Happy birthday Alex!", [0.1, 0, 1]],
        ] as const;
        const vectorOf = new Map<string, Vec>(notes.map(([, text, v]) => [text, Float32Array.from(v)]));
        const elements = notes.map(([id, text], i) => ({
            id,
            type: "path",
            componentType: "sticky-note",
            text,
            x: i * 120,
            y: 0,
            width: 100,
            height: 100,
            locked: false,
            frameId: null,
        }));
        const { ddp, calls } = fakeDdp({
            "command:scene:get-current-selected-drawdy-elements": () => ({ drawdyElementIds: elements.map((e) => e.id) }),
            "command:scene:get-drawdy-elements": (req) => ({
                drawdyElements: elements.filter((e) => !req.drawdyElementIds || req.drawdyElementIds.includes(e.id)),
            }),
            "command:scene:query-rect": () => ({ drawdyElements: [] }),
            "command:scene:add-drawdy-elements": () => ({}),
            "command:scene:clear-selection": () => undefined,
            "command:dom:window-size": () => ({ width: 1440, height: 900 }),
            "command:camera:fly-to-rect": () => undefined,
            "command:scene:begin-preview": () => ({ began: [] }),
            "command:scene:update-drawdy-elements": () => ({}),
        });
        const names = new Map<string, Vec>([
            ["Security", Float32Array.from([1, 0, 0])],
            ["Speed", Float32Array.from([0, 1, 0])],
            ["Pizza", Float32Array.from([0, 0, 0])],
        ]);
        const notices: [string, string][] = [];
        let id = 0;
        const ctx = {
            ddp,
            generateId: () => `frame-${++id}`,
            highlight: { clear: async () => undefined },
            embeddings: {
                items: async () => [],
                texts: async (task: string, texts: readonly string[]) =>
                    texts.map((t) => (task === "query" ? names.get(t)! : vectorOf.get(t)!)),
            },
            notify: (text: string, tone: string) => void notices.push([text, tone]),
            busy: () => undefined,
        } as unknown as Context;
        return { ctx, calls, notices };
    };

    it("files each note under the group it fits, and what fits none under Other", async () => {
        const { ctx, calls, notices } = board();
        const groups = await clusterSelection(ctx, { groups: "Security, Speed, Other" });
        expect(groups?.map((g) => [g.label, g.count])).toEqual([
            ["Security", 2],
            ["Speed", 2],
            ["Other", 2],
        ]);
        const frames = calls.find((c) => c.type === "command:scene:add-drawdy-elements")!.req.elements;
        expect(frames.map((f: { name: string }) => f.name)).toEqual(["Security", "Speed", "Other"]);
        // Only where each note is and which frame holds it change.
        const { updates } = calls.find((c) => c.type === "command:scene:update-drawdy-elements")!.req;
        expect(new Set(updates.flatMap((u: { properties: object }) => Object.keys(u.properties)))).toEqual(new Set(["transform", "frameId"]));
        const frameOf = (id: string) => updates.find((u: { drawdyElementId: string }) => u.drawdyElementId === id).properties.frameId;
        expect([frameOf("s1"), frameOf("p1"), frameOf("o1")]).toEqual(["frame-1", "frame-2", "frame-3"]);
        expect(notices.at(-1)).toEqual(["Sorted 6 notes into 3 groups. 2 notes fit none of your groups, so they went to Other.", "success"]);
    });

    it("moves nothing when nothing fits the one group typed", async () => {
        const { ctx, calls, notices } = board();
        expect(await clusterSelection(ctx, { groups: "Pizza" })).toBeNull();
        expect(calls.some((c) => c.type === "command:scene:add-drawdy-elements")).toBe(false);
        expect(notices.at(-1)).toEqual(["Nothing fit “Pizza”, so nothing moved.", "info"]);
    });

    it("asks for groups when only a catch-all was typed", async () => {
        const { ctx, calls, notices } = board();
        expect(await clusterSelection(ctx, { groups: " Other , " })).toBeNull();
        expect(calls).toHaveLength(0);
        expect(notices.at(-1)?.[1]).toBe("info");
    });
});

describe("group frame", () => {
    it("names the frame after its group, so the name shows on the board", () => {
        const rect = { x: 10, y: 20, width: 300, height: 200 };
        expect(groupFrame({ id: "f1", rect, label: "CI" })).toEqual({
            type: "frame",
            drawdyElementId: "f1",
            name: "CI",
            position: [10, 20],
            width: 300,
            height: 200,
            rotation: 0,
            meta: { [MARK]: "frame", label: "CI" },
        });
    });
});
