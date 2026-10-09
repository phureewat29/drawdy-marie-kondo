/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { webviewScript } from "../driver/webview-html.ts";
import { appIcon } from "../shared/app-icon.ts";
import { ICONS } from "../shared/icons.ts";
import { MODEL, TRANSFORMERS, type WebviewToDriver } from "../shared/protocol.ts";
import { createEngine } from "./engine.ts";
import { PANEL_BODY } from "./markup.ts";
import { createPanel } from "./panel.ts";

/**
 * Rebuilds a function from its source text alone, as the webview receives
 * it: any reference to the module around it would throw when it runs.
 */
const isolate = <F>(fn: F): F => new Function(`return (${String(fn)});`)() as F;

const icons = { note: ICONS.note, text: ICONS.text, shape: ICONS.shape, image: ICONS.image };
const config = { model: MODEL, transformers: TRANSFORMERS, icons };

describe("webview script", () => {
    const script = webviewScript(config);

    it("is valid JavaScript on its own", () => {
        expect(() => new Function(script)).not.toThrow();
    });

    it("calls no compiler helpers, which would not exist in the webview", () => {
        expect(script).not.toMatch(/\b(?:__\w+|_interop\w*|require)\s*\(/);
    });
});

describe("panel", () => {
    const setup = () => {
        document.body.innerHTML = PANEL_BODY;
        const post = jest.fn<(message: WebviewToDriver) => void>();
        const panel = isolate(createPanel)({ post, document, icons, model: MODEL.id });
        const query = document.getElementById("query") as HTMLInputElement;
        const type = (value: string) => {
            query.value = value;
            query.dispatchEvent(new Event("input"));
        };
        return { post, panel, type };
    };
    const hits = [
        { id: "a", kind: "note" as const, label: "Delivery fee is too high", score: 0.81, copies: 3 },
        { id: "b", kind: "image" as const, label: "Image", score: 0.64, copies: 1 },
    ];

    beforeEach(() => {
        jest.useFakeTimers();
    });

    it("searches after typing stops, then shows ranked hits", () => {
        const { post, panel, type } = setup();
        type("fees");
        jest.advanceTimersByTime(500);
        expect(post).toHaveBeenCalledWith({ type: "search", query: "fees" });

        panel.dispatch({ type: "driver", message: { type: "results", query: "fees", hits, ms: 12 } });
        const rows = [...document.querySelectorAll("button.hit")];
        expect(rows.map((r) => r.querySelector(".label")?.textContent)).toEqual(["Delivery fee is too high", "Image"]);
        expect(rows[0].querySelector(".kind svg")).not.toBeNull();
        expect(rows[0].querySelector(".pct")?.textContent).toBe("81%");
        // Copies of one note share a row, marked with how many there are.
        expect(rows[0].querySelector(".copies")?.textContent).toBe("×3");
        expect(rows[1].querySelector(".copies")).toBeNull();
    });

    it("suggests searches from the board's notes, and runs one when picked", () => {
        const { post, panel, type } = setup();
        expect(document.querySelectorAll("button.chip")).toHaveLength(0);
        panel.dispatch({ type: "driver", message: { type: "suggestions", queries: ["meetings", "CI"] } });
        const chips = () => [...document.querySelectorAll<HTMLButtonElement>("button.chip")];
        expect(chips().map((c) => c.textContent)).toEqual(["meetings", "CI"]);

        chips()[1].click();
        expect((document.getElementById("query") as HTMLInputElement).value).toBe("CI");
        jest.advanceTimersByTime(500);
        expect(post).toHaveBeenCalledWith({ type: "search", query: "CI" });

        // New suggestions wait while a search is showing.
        panel.dispatch({ type: "driver", message: { type: "results", query: "CI", hits, ms: 12 } });
        panel.dispatch({ type: "driver", message: { type: "suggestions", queries: ["tests"] } });
        expect(document.querySelectorAll("button.hit")).toHaveLength(2);
        type("");
        expect(chips().map((c) => c.textContent)).toEqual(["tests"]);
    });

    it("reveals and hovers hits through the driver", () => {
        const { post, panel, type } = setup();
        type("fees");
        panel.dispatch({ type: "driver", message: { type: "results", query: "fees", hits, ms: 12 } });
        const first = document.querySelector<HTMLButtonElement>("button.hit")!;
        first.dispatchEvent(new Event("mouseenter"));
        first.click();
        expect(post).toHaveBeenCalledWith({ type: "hover", id: "a" });
        expect(post).toHaveBeenCalledWith({ type: "reveal", id: "a" });
    });

    it("drops results for a query that is no longer in the box", () => {
        const { panel, type } = setup();
        type("pricing");
        panel.dispatch({ type: "driver", message: { type: "results", query: "fees", hits, ms: 12 } });
        expect(document.querySelectorAll("button.hit")).toHaveLength(0);
    });

    it("enables clustering from four selected notes and sends the chosen group count", () => {
        const { post, panel } = setup();
        const cluster = document.getElementById("cluster") as HTMLButtonElement;
        panel.dispatch({ type: "driver", message: { type: "board", items: 30, selected: 3 } });
        expect(cluster.disabled).toBe(true);
        panel.dispatch({ type: "driver", message: { type: "board", items: 30, selected: 4 } });
        expect(cluster.disabled).toBe(false);

        (document.getElementById("groups") as HTMLSelectElement).value = "5";
        cluster.click();
        expect(post).toHaveBeenCalledWith({ type: "cluster", k: 5 });
    });

    it("shows a status line only while getting ready, then gets out of the way", () => {
        const { panel } = setup();
        const line = document.getElementById("status")!;
        const status = () => [
            document.getElementById("status-title")?.textContent,
            document.getElementById("status-detail")?.textContent,
        ];
        // Once set up, a download in the panel is the part for photos.
        panel.dispatch({
            type: "engine",
            state: { phase: "loading", progress: 0.43, downloadedBytes: 40e6, detail: "Downloading" },
        });
        expect(line.hidden).toBe(false);
        expect(status()).toEqual(["Getting ready for photos…", "40 of about 109 MB · 37%"]);
        panel.dispatch({ type: "engine", state: { phase: "loading", progress: 0, downloadedBytes: 0, detail: "Loading" } });
        expect(status()).toEqual(["Getting ready…", ""]);
        expect(document.getElementById("progress")!.classList.contains("indeterminate")).toBe(true);
        panel.dispatch({
            type: "engine",
            state: { phase: "ready", device: "webgpu", vision: false, adapter: "apple metal-3", loadMs: 900 },
        });
        expect(line.hidden).toBe(true);
    });

    it("shows the extension's icon, the same SVG Drawdy shows on its sidebar button", () => {
        setup();
        // Drawdy loads the button's SVG as an image, so it must stand on its own.
        const parsed = new DOMParser().parseFromString(appIcon(20), "image/svg+xml");
        expect(parsed.querySelector("parsererror")).toBeNull();
        expect(parsed.documentElement.getAttribute("width")).toBe("20");
        expect(document.querySelector("#setup .mark svg")?.getAttribute("width")).toBe("36");
    });

    it("names the model only in a dim line at the bottom", () => {
        setup();
        expect(document.getElementById("credit")?.textContent).toBe("Engine: EmbeddingGemma 2");
        expect(document.getElementById("status")!.textContent).not.toMatch(/EmbeddingGemma/i);
    });

    it("says once when the browser has no GPU, so slowness is expected", () => {
        const { panel } = setup();
        panel.dispatch({ type: "engine", state: { phase: "ready", device: "wasm", vision: false, adapter: null, loadMs: 900 } });
        expect(document.getElementById("notice")!.textContent).toBe(
            "This browser can't use the GPU, so Marie Kondo is slower here."
        );
    });

    const groups = [
        { frameId: "f1", label: "Fees", count: 6 },
        { frameId: "f2", label: "Delivery", count: 5 },
        { frameId: "f3", label: "Cats", count: 3 },
    ];
    const text = (id: string) => document.getElementById(id)!.textContent;

    it("keeps the groups to one collapsed bar, out of the way while searching", () => {
        const { panel, type } = setup();
        const bar = document.getElementById("clusters")!;
        panel.dispatch({ type: "driver", message: { type: "clusters", clusters: groups } });
        expect(bar.hidden).toBe(false);
        expect(text("groups-title")).toBe("3 groups");
        expect(document.getElementById("groups-list")!.hidden).toBe(true);
        type("refunds");
        expect(bar.hidden).toBe(true);
        type("");
        expect(bar.hidden).toBe(false);
    });

    it("steps between groups, wrapping around, and goes to each on the board", () => {
        const { post, panel } = setup();
        panel.dispatch({ type: "driver", message: { type: "clusters", clusters: groups } });
        const next = document.getElementById("group-next") as HTMLButtonElement;
        const prev = document.getElementById("group-prev") as HTMLButtonElement;
        next.click();
        expect(post).toHaveBeenLastCalledWith({ type: "go-to-group", frameId: "f1" });
        expect([text("groups-title"), text("group-pos")]).toEqual(["Fees", "1 / 3"]);
        next.click();
        expect([text("groups-title"), text("group-pos")]).toEqual(["Delivery", "2 / 3"]);
        prev.click();
        prev.click();
        expect(post).toHaveBeenLastCalledWith({ type: "go-to-group", frameId: "f3" });
        expect(text("group-pos")).toBe("3 / 3");
    });

    it("opens into a numbered list whose rows go to their group", () => {
        const { post, panel } = setup();
        panel.dispatch({ type: "driver", message: { type: "clusters", clusters: groups } });
        const toggle = document.getElementById("groups-toggle")!;
        toggle.click();
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        const rows = [...document.querySelectorAll<HTMLButtonElement>("#groups-list .group")];
        expect(rows.map((r) => [r.querySelector(".index")?.textContent, r.querySelector(".name")?.textContent])).toEqual([
            ["1", "Fees"],
            ["2", "Delivery"],
            ["3", "Cats"],
        ]);
        rows[1].click();
        expect(post).toHaveBeenLastCalledWith({ type: "go-to-group", frameId: "f2" });
        expect(document.querySelector('#groups-list .group[aria-current="true"] .name')?.textContent).toBe("Delivery");
        toggle.click();
        expect(document.getElementById("groups-list")!.hidden).toBe(true);
    });

    it("follows a group selected on the board, and steps on from it", () => {
        const { post, panel } = setup();
        panel.dispatch({ type: "driver", message: { type: "clusters", clusters: groups } });
        panel.dispatch({ type: "driver", message: { type: "board", items: 14, selected: 5, single: "f2" } });
        expect([text("groups-title"), text("group-pos")]).toEqual(["Delivery", "2 / 3"]);
        (document.getElementById("group-next") as HTMLButtonElement).click();
        expect(post).toHaveBeenLastCalledWith({ type: "go-to-group", frameId: "f3" });
        // Selecting something else keeps the place.
        panel.dispatch({ type: "driver", message: { type: "board", items: 14, selected: 1 } });
        expect(text("group-pos")).toBe("3 / 3");
    });

    it("knows the selected group even when the list arrives after the selection", () => {
        const { panel } = setup();
        panel.dispatch({ type: "driver", message: { type: "board", items: 14, selected: 3, single: "f3" } });
        panel.dispatch({ type: "driver", message: { type: "clusters", clusters: groups } });
        expect([text("groups-title"), text("group-pos")]).toEqual(["Cats", "3 / 3"]);
    });

    it("forgets the current group once it is gone from the board", () => {
        const { panel } = setup();
        panel.dispatch({ type: "driver", message: { type: "clusters", clusters: groups } });
        (document.getElementById("group-next") as HTMLButtonElement).click();
        panel.dispatch({ type: "driver", message: { type: "clusters", clusters: groups.slice(1) } });
        expect([text("groups-title"), text("group-pos")]).toEqual(["2 groups", ""]);
    });

    it("explains why Group is unavailable for a small selection", () => {
        const { panel } = setup();
        panel.dispatch({ type: "driver", message: { type: "board", items: 12, selected: 3 } });
        expect((document.getElementById("cluster") as HTMLButtonElement).disabled).toBe(true);
        expect(text("stats")).toBe("3 selected · Group needs 4 or more");
    });

    it("points an empty board at the sample notes", () => {
        const { panel } = setup();
        const demo = document.getElementById("demo")!;
        const stats = document.getElementById("stats")!;
        // Quiet until the board is counted, so a full board never flashes it.
        expect(demo.classList.contains("primary")).toBe(false);
        expect(demo.classList.contains("quiet")).toBe(true);
        panel.dispatch({ type: "driver", message: { type: "board", items: 0, selected: 0 } });
        expect(demo.classList.contains("primary")).toBe(true);
        expect(demo.classList.contains("quiet")).toBe(false);
        expect(demo.textContent).toBe("Try with sample notes");
        expect(stats.textContent).toBe("No notes on this board yet");
        panel.dispatch({ type: "driver", message: { type: "board", items: 1, selected: 1 } });
        expect(demo.classList.contains("primary")).toBe(false);
        expect(demo.classList.contains("quiet")).toBe(true);
        expect(stats.textContent).toBe("1 of 1 selected");
    });

    it("disables actions while Marie Kondo is busy", () => {
        const { panel } = setup();
        const cluster = document.getElementById("cluster") as HTMLButtonElement;
        panel.dispatch({ type: "driver", message: { type: "board", items: 30, selected: 30 } });
        panel.dispatch({ type: "driver", message: { type: "busy", text: "Grouping 30 notes…" } });
        expect(cluster.disabled).toBe(true);
        expect(document.getElementById("status-title")?.textContent).toBe("Grouping 30 notes…");
        panel.dispatch({ type: "driver", message: { type: "busy", text: null } });
        expect(cluster.disabled).toBe(false);
    });

    it("shows a long task's progress, then hides the bar", () => {
        const { panel } = setup();
        const bar = document.getElementById("progress")!;
        panel.dispatch({
            type: "engine",
            state: { phase: "ready", device: "webgpu", vision: false, adapter: null, loadMs: 900 },
        });
        expect(bar.hidden).toBe(true);
        panel.dispatch({ type: "driver", message: { type: "busy", text: "Reading 1,000 notes…", progress: 0.4 } });
        expect(bar.hidden).toBe(false);
        expect(bar.getAttribute("aria-valuenow")).toBe("40");
        expect(document.getElementById("progress-bar")!.style.width).toBe("40%");
        panel.dispatch({ type: "driver", message: { type: "busy", text: null } });
        expect(bar.hidden).toBe(true);
    });

    it("says it is searching, and dims older results until the new ones arrive", () => {
        const { panel, type } = setup();
        const results = document.getElementById("results")!;
        type("fees");
        expect(results.textContent).toBe("Searching as soon as Marie Kondo is ready…");
        panel.dispatch({
            type: "engine",
            state: { phase: "ready", device: "webgpu", vision: false, adapter: null, loadMs: 900 },
        });
        expect(results.textContent).toBe("Searching…");
        panel.dispatch({ type: "driver", message: { type: "results", query: "fees", hits, ms: 12 } });
        expect(results.classList.contains("stale")).toBe(false);
        type("fees and charges");
        expect(results.classList.contains("stale")).toBe(true);
        expect(document.querySelectorAll("button.hit")).toHaveLength(2);
        type("");
        expect(results.classList.contains("stale")).toBe(false);
    });

    it("announces a failed start once set up (before that, the setup card says it)", () => {
        const { panel } = setup();
        panel.dispatch({ type: "driver", message: { type: "setup", needed: false } });
        panel.dispatch({ type: "engine", state: { phase: "error", message: "No space left on device" } });
        const notice = document.getElementById("notice")!;
        expect(notice.hidden).toBe(false);
        expect(notice.className).toBe("error");
        expect(notice.textContent).toBe("Couldn't start: No space left on device");
    });

    it("asks before the one-time download, shows its progress, then the panel", () => {
        const { post, panel } = setup();
        const visible = (id: string) => !document.getElementById(id)!.hidden;
        const text = (id: string) => document.getElementById(id)!.textContent;
        const button = document.getElementById("setup-download") as HTMLButtonElement;
        expect(visible("boot")).toBe(true);
        expect(visible("work")).toBe(false);

        panel.dispatch({ type: "driver", message: { type: "setup", needed: true } });
        expect(visible("setup")).toBe(true);
        expect(visible("work")).toBe(false);
        expect(text("setup-title")).toBe("Set up Marie Kondo");
        expect(text("setup-label")).toBe("Download (235 MB)");
        // What will download, by its id, in code style.
        expect(document.querySelector("#setup code#setup-model")?.textContent).toBe(MODEL.id);
        expect(visible("setup-file-line")).toBe(false);

        button.click();
        expect(post).toHaveBeenCalledWith({ type: "download" });
        expect(button.disabled).toBe(true);

        panel.dispatch({
            type: "engine",
            state: { phase: "loading", progress: 0.5, downloadedBytes: 120e6, detail: "Downloading", file: "onnx/model_q4.onnx_data" },
        });
        expect(text("setup-title")).toBe("Setting up Marie Kondo…");
        expect(text("setup-file")).toBe("onnx/model_q4.onnx_data");
        expect(visible("setup-file-line")).toBe(true);
        expect(text("setup-detail")).toBe("120 of about 235 MB · 51%");
        expect(visible("setup-progress")).toBe(true);
        expect(visible("setup-download")).toBe(false);

        panel.dispatch({ type: "engine", state: { phase: "error", message: "Failed to fetch" } });
        expect(text("setup-title")).toBe("Couldn't finish the download");
        expect(text("setup-label")).toBe("Try again");
        expect(button.disabled).toBe(false);
        expect(visible("setup-download")).toBe(true);

        panel.dispatch({ type: "driver", message: { type: "setup", needed: false } });
        expect(visible("setup")).toBe(false);
        expect(visible("work")).toBe(true);
    });

    it("goes straight to the panel when the download was done before", () => {
        const { panel } = setup();
        panel.dispatch({ type: "driver", message: { type: "setup", needed: false } });
        expect(document.getElementById("work")!.hidden).toBe(false);
        expect(document.getElementById("setup")!.hidden).toBe(true);
        expect(document.getElementById("boot")!.hidden).toBe(true);
    });

    it("clears the search on Escape", () => {
        const { type, post } = setup();
        type("fees");
        const query = document.getElementById("query") as HTMLInputElement;
        query.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(query.value).toBe("");
        expect(post).toHaveBeenLastCalledWith({ type: "hover", id: null });
    });

    it("hides a notice after a while", () => {
        const { panel } = setup();
        const notice = document.getElementById("notice")!;
        panel.dispatch({ type: "driver", message: { type: "notice", text: "Sorted 30 notes", tone: "success" } });
        expect(notice.hidden).toBe(false);
        jest.advanceTimersByTime(6000);
        expect(notice.hidden).toBe(true);
    });
});

describe("engine", () => {
    beforeEach(() => {
        jest.useRealTimers();
    });

    it("starts idle and settles cache replies from its own source alone", () => {
        const post = jest.fn<(message: WebviewToDriver) => void>();
        const engine = isolate(createEngine)({ config, post, onState: () => undefined, importModule: async () => ({}) });
        expect(engine.current()).toEqual({ phase: "idle" });
        expect(() => engine.handle({ type: "cache-got", requestId: 7, blob: null })).not.toThrow();
        expect(post).not.toHaveBeenCalled();
    });
});
