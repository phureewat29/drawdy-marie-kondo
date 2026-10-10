import type {
    ClusterSummary,
    DriverToWebview,
    EngineState,
    SearchHit,
    Tone,
    WebviewToDriver,
} from "../shared/protocol.ts";
import type { ICONS } from "../shared/icons.ts";

/** The icons the panel draws at runtime (static ones are in the markup). */
export type PanelIcons = Pick<typeof ICONS, "note" | "text" | "shape" | "image">;

type PanelMessage = Extract<
    DriverToWebview,
    { type: "results" | "board" | "clusters" | "suggestions" | "notice" | "busy" | "setup" }
>;

export type PanelEvent =
    | { type: "engine"; state: EngineState }
    | { type: "driver"; message: PanelMessage }
    | { type: "query"; value: string }
    | { type: "notice-expired"; id: number }
    /** The user pressed Download (or Try again). */
    | { type: "download" }
    | { type: "toggle-groups" }
    /** Manual on or off: group into the user's own groups, or by meaning. */
    | { type: "toggle-manual" }
    | { type: "groups-text"; value: string }
    /** The group the user went to last, by its frame. */
    | { type: "current-group"; frameId: string };

export type PanelState = {
    /** The one-time download: not known yet, still to do, or done. */
    setup: "unknown" | "needed" | "done";
    /** Download pressed, until the engine answers. */
    starting: boolean;
    engine: EngineState;
    /** What Janitor is doing, and how far along (0..1) when it knows. */
    busy: { text: string; progress?: number } | null;
    query: string;
    results: { query: string; hits: SearchHit[]; ms: number; error?: string } | null;
    /** `single` is the one selected element, when exactly one is selected. */
    board: { items: number; selected: number; single?: string; counted: boolean };
    /** The board's groups, in reading order. */
    clusters: ClusterSummary[];
    /** Searches to suggest, from the board's own notes. */
    suggestions: string[];
    /** Whether the group list is open; the bar alone shows otherwise. */
    groupsOpen: boolean;
    /** The group the user went to last, while it exists. */
    currentGroup: string | null;
    /** Group into the groups the user typed (`groupsText`), instead of by meaning. */
    manual: boolean;
    groupsText: string;
    notice: { id: number; text: string; tone: Tone } | null;
};

export type PanelDeps = {
    post: (message: WebviewToDriver) => void;
    document: Document;
    icons: PanelIcons;
    /** The model's id, shown where the download is asked for. */
    model: string;
};

export type Panel = { dispatch: (event: PanelEvent) => void };

/**
 * The panel UI, Elm style: one immutable state, a pure `reduce`, and a
 * `render` that redraws only the sections whose state changed.
 *
 * Self-contained by design: the driver serializes this function into the
 * webview, so it may only use its parameters, browser globals and what it
 * defines itself.
 */
export const createPanel = ({ post, document: doc, icons, model }: PanelDeps): Panel => {
    const SEARCH_DEBOUNCE_MS = 180;

    /** The one-time downloads, as the panel describes and measures them. */
    const DOWNLOAD_MB = 235;
    const IMAGES_MB = 109;
    /**
     * Download progress in bytes against the known total, so it only moves
     * forward (files start one by one, and the last one reports no
     * progress); "almost" covers that last stretch and the start-up after.
     */
    const downloaded = (bytes: number, totalMb: number) => {
        const fraction = bytes / (totalMb * 1e6);
        return { pct: Math.min(99, Math.round(fraction * 100)), mb: Math.round(bytes / 1e6), almost: fraction >= 0.85 };
    };

    const initial: PanelState = {
        setup: "unknown",
        starting: false,
        engine: { phase: "idle" },
        busy: null,
        query: "",
        results: null,
        board: { items: 0, selected: 0, counted: false },
        clusters: [],
        suggestions: [],
        groupsOpen: false,
        currentGroup: null,
        manual: false,
        groupsText: "",
        notice: null,
    };

    const nextNotice = (s: PanelState, text: string, tone: Tone) => ({ id: (s.notice?.id ?? 0) + 1, text, tone });
    const isGroup = (clusters: readonly ClusterSummary[], id: string | null | undefined): id is string =>
        id !== null && id !== undefined && clusters.some((c) => c.frameId === id);

    const reduce = (s: PanelState, e: PanelEvent): PanelState => {
        switch (e.type) {
            case "engine": {
                const next = { ...s, starting: false, engine: e.state };
                // A failed start is also announced, since the status line is
                // not a live region for its detail (the setup card says it).
                if (e.state.phase === "error" && s.engine.phase !== "error" && s.setup === "done") {
                    return { ...next, notice: nextNotice(s, `Couldn't start: ${e.state.message}`, "error") };
                }
                // Said once, as Janitor gets ready: why it may feel slow.
                if (e.state.phase === "ready" && e.state.device === "wasm" && s.engine.phase !== "ready") {
                    return { ...next, notice: nextNotice(s, "This browser can't use the GPU, so Janitor is slower here.", "info") };
                }
                return next;
            }
            case "toggle-groups":
                return { ...s, groupsOpen: !s.groupsOpen };
            case "toggle-manual":
                return { ...s, manual: !s.manual };
            case "groups-text":
                return { ...s, groupsText: e.value };
            case "current-group":
                return { ...s, currentGroup: e.frameId };
            case "download":
                return { ...s, starting: true };
            case "query":
                return { ...s, query: e.value, results: e.value ? s.results : null };
            case "notice-expired":
                return s.notice?.id === e.id ? { ...s, notice: null } : s;
            case "driver": {
                const m = e.message;
                switch (m.type) {
                    case "results":
                        return m.query === s.query
                            ? { ...s, results: { query: m.query, hits: m.hits, ms: m.ms, error: m.error } }
                            : s;
                    case "board":
                        return {
                            ...s,
                            board: { items: m.items, selected: m.selected, single: m.single, counted: true },
                            currentGroup: isGroup(s.clusters, m.single) ? m.single : s.currentGroup,
                        };
                    case "clusters":
                        return {
                            ...s,
                            clusters: m.clusters,
                            currentGroup: isGroup(m.clusters, s.board.single)
                                ? s.board.single
                                : isGroup(m.clusters, s.currentGroup)
                                  ? s.currentGroup
                                  : null,
                        };
                    case "suggestions":
                        return { ...s, suggestions: m.queries };
                    case "notice":
                        return { ...s, notice: nextNotice(s, m.text, m.tone) };
                    case "busy":
                        return { ...s, busy: m.text === null ? null : { text: m.text, progress: m.progress } };
                    case "setup":
                        return { ...s, setup: m.needed ? "needed" : "done" };
                }
            }
        }
    };

    // --- view -------------------------------------------------------------

    const byId = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T;
    /** An icon from a trusted, build-time SVG string. */
    const icon = (svg: string): Node => {
        const holder = doc.createElement("span");
        holder.innerHTML = svg;
        return holder.firstElementChild ?? holder;
    };
    const h = (
        tag: string,
        props: {
            className?: string;
            text?: string;
            title?: string;
            style?: Partial<CSSStyleDeclaration>;
            on?: Record<string, () => void>;
        } = {},
        ...children: Node[]
    ): HTMLElement => {
        const el = doc.createElement(tag);
        if (props.className) el.className = props.className;
        if (props.text !== undefined) el.textContent = props.text;
        if (props.title) el.title = props.title;
        if (props.style) Object.assign(el.style, props.style);
        for (const [name, listener] of Object.entries(props.on ?? {})) el.addEventListener(name, listener);
        el.append(...children);
        return el;
    };
    const el = {
        boot: byId("boot"),
        setup: byId("setup"),
        work: byId("work"),
        setupTitle: byId("setup-title"),
        setupText: byId("setup-text"),
        setupProgress: byId("setup-progress"),
        setupBar: byId("setup-bar"),
        setupDetail: byId("setup-detail"),
        setupModel: byId("setup-model"),
        setupFile: byId("setup-file"),
        setupFileLine: byId("setup-file-line"),
        setupButton: byId<HTMLButtonElement>("setup-download"),
        setupLabel: byId("setup-label"),
        setupNote: byId("setup-note"),
        setupNotice: byId("setup-notice"),
        status: byId("status"),
        title: byId("status-title"),
        detail: byId("status-detail"),
        progress: byId("progress"),
        progressBar: byId("progress-bar"),
        query: byId<HTMLInputElement>("query"),
        results: byId("results"),
        clusters: byId("clusters"),
        groupsToggle: byId<HTMLButtonElement>("groups-toggle"),
        groupsTitle: byId("groups-title"),
        groupPrev: byId<HTMLButtonElement>("group-prev"),
        groupNext: byId<HTMLButtonElement>("group-next"),
        groupPos: byId("group-pos"),
        groupsList: byId("groups-list"),
        notice: byId("notice"),
        cluster: byId<HTMLButtonElement>("cluster"),
        manual: byId("manual"),
        manualToggle: byId<HTMLButtonElement>("manual-toggle"),
        manualGroups: byId<HTMLInputElement>("manual-groups"),
        similar: byId<HTMLButtonElement>("similar"),
        demo: byId<HTMLButtonElement>("demo"),
        stats: byId("stats"),
    };

    /** Getting ready, or a failure, in product terms; nothing once ready. */
    const engineStatus = (engine: EngineState): { title: string; detail: string } | null => {
        switch (engine.phase) {
            case "loading": {
                // Set up already, so a download here is the part for photos.
                if (engine.downloadedBytes === 0) return { title: "Getting ready…", detail: "" };
                const { pct, mb, almost } = downloaded(engine.downloadedBytes, IMAGES_MB);
                return {
                    title: "Getting ready for photos…",
                    detail: almost ? "Almost ready" : `${mb} of about ${IMAGES_MB} MB · ${pct}%`,
                };
            }
            case "error":
                return { title: "Couldn't start", detail: engine.message };
            default:
                return null;
        }
    };

    /** The status line shows only while something is happening. */
    const renderStatus = (s: PanelState) => {
        const engine = s.engine;
        const getting = engineStatus(engine);
        el.status.hidden = s.busy === null && getting === null;
        el.title.textContent = s.busy?.text ?? getting?.title ?? "";
        el.detail.textContent = getting?.detail ?? "";
        // Getting ready shows its own progress first; then the task's.
        const loading = engine.phase === "loading";
        const progress =
            engine.phase === "loading"
                ? engine.downloadedBytes > 0
                    ? downloaded(engine.downloadedBytes, IMAGES_MB).pct / 100
                    : undefined
                : s.busy?.progress;
        el.progress.hidden = !loading && progress === undefined;
        el.progress.classList.toggle("indeterminate", loading && progress === undefined);
        if (progress !== undefined) {
            const pct = Math.round(progress * 100);
            el.progressBar.style.width = `${pct}%`;
            el.progress.setAttribute("aria-valuenow", String(pct));
        } else el.progress.removeAttribute("aria-valuenow");
    };

    /** How search works, with searches suggested by what the board's notes talk about. */
    const hintView = (suggestions: readonly string[]) =>
        h(
            "div",
            { className: "hint muted" },
            doc.createTextNode("Search the board by "),
            h("b", { text: "meaning" }),
            doc.createTextNode(", not keywords. Ask in any language."),
            ...(suggestions.length > 0
                ? [
                      h(
                          "div",
                          { className: "examples", title: "Topics your notes mention most" },
                          ...suggestions.map((query) =>
                              h("button", { className: "chip", text: query, on: { click: () => setQuery(query) } })
                          )
                      ),
                  ]
                : [])
        );

    const hitView = (hit: SearchHit, best: number) =>
        h(
            "button",
            {
                className: "hit",
                on: {
                    click: () => post({ type: "reveal", id: hit.id }),
                    mouseenter: () => post({ type: "hover", id: hit.id }),
                    focus: () => post({ type: "hover", id: hit.id }),
                },
            },
            h("span", { className: "kind" }, icon(icons[hit.kind])),
            h("span", { className: "label", text: hit.label }),
            ...(hit.copies > 1
                ? [h("span", { className: "copies muted small", text: `×${hit.copies}`, title: `${hit.copies} notes say this` })]
                : []),
            h(
                "span",
                { className: "score" },
                h("div", { className: "pct muted", text: `${Math.round(hit.score * 100)}%` }),
                h("div", { className: "bar" }, h("i", { style: { width: `${Math.max(6, Math.round((hit.score / best) * 100))}%` } }))
            )
        );

    const renderResults = (s: PanelState) => {
        // Earlier results stay, dimmed, until this query's arrive.
        el.results.classList.toggle("stale", s.query !== "" && s.results !== null && s.results.query !== s.query);
        if (!s.query) return el.results.replaceChildren(hintView(s.suggestions));
        if (!s.results) {
            const waiting = s.engine.phase === "ready" ? "Searching…" : "Searching as soon as Janitor is ready…";
            return el.results.replaceChildren(h("div", { className: "hint muted", text: waiting }));
        }
        const { hits, ms, error } = s.results;
        if (error) return el.results.replaceChildren(h("div", { className: "hint muted", text: error }));
        if (hits.length === 0) {
            return el.results.replaceChildren(h("div", { className: "hint muted", text: "Nothing on this board to search yet." }));
        }
        el.results.replaceChildren(
            ...hits.map((hit) => hitView(hit, hits[0].score)),
            h("div", { className: "muted small", text: `Ranked on your device in ${ms} ms`, style: { padding: "6px 8px" } })
        );
    };

    /**
     * The groups bar: one line by default, naming the group you are on and
     * stepping between groups; it opens into the numbered list. It steps
     * aside while a search is showing results.
     */
    const renderClusters = (s: PanelState) => {
        const { clusters } = s;
        el.clusters.hidden = clusters.length === 0 || s.query !== "";
        const at = clusters.findIndex((c) => c.frameId === s.currentGroup);
        el.groupsTitle.textContent =
            at >= 0 ? clusters[at].label : `${clusters.length} ${clusters.length === 1 ? "group" : "groups"}`;
        el.groupPos.textContent = at >= 0 ? `${at + 1} / ${clusters.length}` : "";
        el.groupsToggle.setAttribute("aria-expanded", String(s.groupsOpen));
        el.groupsToggle.title = s.groupsOpen ? "Hide the list of groups" : "Show all groups";
        el.groupsList.hidden = !s.groupsOpen;
        el.groupsList.replaceChildren(
            ...clusters.map((c, i) => {
                const row = h(
                    "button",
                    { className: "group", on: { click: () => goTo(i) } },
                    h("span", { className: "index muted small", text: String(i + 1) }),
                    h("span", { className: "name", text: c.label }),
                    h("span", { className: "count muted small", text: String(c.count) })
                );
                row.setAttribute("aria-current", String(i === at));
                return row;
            })
        );
    };

    const renderNotice = (s: PanelState) => {
        el.notice.hidden = s.notice === null;
        el.notice.className = s.notice?.tone ?? "";
        el.notice.textContent = s.notice?.text ?? "";
        el.setupNotice.textContent = s.notice?.text ?? "";
    };

    /**
     * Before the one-time download: what it is, how big, and a button to
     * start it; then its progress; then the panel itself.
     */
    const renderSetup = (s: PanelState) => {
        el.boot.hidden = s.setup !== "unknown";
        el.setup.hidden = s.setup !== "needed";
        el.work.hidden = s.setup !== "done";
        if (s.setup !== "needed") return;
        const { engine } = s;
        const loading = engine.phase === "loading" || engine.phase === "ready";
        const failed = engine.phase === "error";
        el.setupTitle.textContent = failed
            ? "Couldn't finish the download"
            : loading
              ? "Setting up Janitor…"
              : "Set up Janitor";
        el.setupText.textContent = failed
            ? `${engine.message}. Check your connection, then try again.`
            : loading
              ? "Downloading the model Janitor runs on your device. This happens once:"
              : `Janitor works on your device, so your notes never leave this browser. It needs a one-time download of this model, about ${DOWNLOAD_MB} MB:`;
        el.setupModel.textContent = model;
        // The file being read right now, so a long download is visibly moving.
        const file = engine.phase === "loading" ? engine.file : undefined;
        el.setupFileLine.hidden = !file;
        el.setupFile.textContent = file ?? "";
        el.setupProgress.hidden = !loading;
        el.setupDetail.textContent = "";
        const measured = engine.phase === "loading" && engine.downloadedBytes > 0;
        el.setupProgress.classList.toggle("indeterminate", loading && !measured);
        if (measured) {
            const { pct, mb, almost } = downloaded(engine.downloadedBytes, DOWNLOAD_MB);
            el.setupBar.style.width = `${pct}%`;
            el.setupProgress.setAttribute("aria-valuenow", String(pct));
            el.setupDetail.textContent = almost ? "Almost ready…" : `${mb} of about ${DOWNLOAD_MB} MB · ${pct}%`;
        } else if (loading) el.setupDetail.textContent = "Getting ready on this device…";
        el.setupButton.hidden = loading;
        el.setupButton.disabled = s.starting;
        el.setupLabel.textContent = failed ? "Try again" : `Download (${DOWNLOAD_MB} MB)`;
        el.setupNote.textContent = loading
            ? "You can keep working on your board meanwhile."
            : `Grouping photos adds ${IMAGES_MB} MB the first time.`;
    };

    /** Manual opens the box for the user's own groups above the buttons; closed, it cannot be focused. */
    const renderManual = (s: PanelState) => {
        el.manual.classList.toggle("open", s.manual);
        el.manual.toggleAttribute("inert", !s.manual);
        el.manualToggle.setAttribute("aria-pressed", String(s.manual));
        el.manualToggle.setAttribute("aria-expanded", String(s.manual));
    };

    /** Action buttons follow the selection, and wait while Janitor works. */
    const renderBoard = (s: PanelState) => {
        const { items, selected, counted } = s.board;
        const busy = s.busy !== null;
        const empty = counted && items === 0;
        // One short line. Group needs a few items to sort: with 2 or 3
        // selected, say so rather than leave it disabled unexplained (one
        // selected note is more likely for Find similar).
        el.stats.textContent =
            selected >= 2 && selected < 4
                ? `${selected} selected · Group needs 4 or more`
                : selected > 0
                  ? `${selected} of ${items} selected`
                  : !counted
                    ? ""
                    : empty
                      ? "No notes on this board yet"
                      : `${items} ${items === 1 ? "note or image" : "notes & images"} on this board`;
        // On an empty board, the sample notes are the way in; otherwise (and
        // until the board is counted) they stay quiet text.
        el.demo.classList.toggle("primary", empty);
        el.demo.classList.toggle("quiet", !empty);
        // Manual needs at least one group typed; the driver reads them properly.
        const typed = s.groupsText.split(/[,;\n]/).some((name) => name.trim() !== "");
        el.cluster.disabled = busy || selected < 4 || (s.manual && !typed);
        el.cluster.title =
            selected < 4
                ? "Select 4 or more notes or images first"
                : !s.manual
                  ? "Sort the selection into groups by meaning"
                  : typed
                    ? "Sort the selection into your groups"
                    : "Type your groups first";
        el.similar.disabled = busy || selected < 1;
        el.demo.disabled = busy;
    };

    const render = (prev: PanelState | null, next: PanelState) => {
        const changed = <K extends keyof PanelState>(...keys: K[]) => prev === null || keys.some((k) => prev[k] !== next[k]);
        if (changed("setup", "engine", "starting")) renderSetup(next);
        if (changed("engine", "busy")) renderStatus(next);
        const phaseChanged = prev === null || prev.engine.phase !== next.engine.phase;
        const hintChanged = changed("suggestions") && !next.query;
        if (changed("query", "results") || hintChanged || (phaseChanged && next.query && !next.results)) {
            renderResults(next);
        }
        if (changed("clusters", "query", "groupsOpen", "currentGroup")) renderClusters(next);
        if (changed("notice")) renderNotice(next);
        if (changed("manual")) renderManual(next);
        if (changed("board", "busy", "manual", "groupsText")) renderBoard(next);
    };

    // --- store and effects ---------------------------------------------------

    let state = initial;
    const dispatch = (event: PanelEvent) => {
        const prev = state;
        state = reduce(prev, event);
        if (state === prev) return;
        render(prev, state);
        const notice = state.notice;
        if (notice && notice !== prev.notice) {
            setTimeout(() => dispatch({ type: "notice-expired", id: notice.id }), notice.tone === "error" ? 9000 : 5000);
        }
    };

    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    const setQuery = (value: string) => {
        el.query.value = value;
        onInput();
    };
    const onInput = () => {
        const query = el.query.value.trim();
        dispatch({ type: "query", value: query });
        clearTimeout(searchTimer);
        if (!query) return post({ type: "hover", id: null });
        searchTimer = setTimeout(() => post({ type: "search", query }), SEARCH_DEBOUNCE_MS);
    };

    el.query.addEventListener("input", onInput);
    el.query.addEventListener("keydown", (e) => {
        const first = el.results.querySelector<HTMLButtonElement>("button.hit");
        if (e.key === "Enter") first?.click();
        if (e.key === "ArrowDown") first?.focus();
        if (e.key === "Escape") setQuery("");
    });
    el.results.addEventListener("mouseleave", () => post({ type: "hover", id: null }));
    el.cluster.addEventListener("click", () =>
        post(state.manual ? { type: "cluster", groups: state.groupsText } : { type: "cluster" })
    );
    el.manualToggle.addEventListener("click", () => {
        dispatch({ type: "toggle-manual" });
        if (state.manual) el.manualGroups.focus();
    });
    el.manualGroups.addEventListener("input", () => dispatch({ type: "groups-text", value: el.manualGroups.value }));
    el.manualGroups.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !el.cluster.disabled) el.cluster.click();
        if (e.key === "Escape") {
            dispatch({ type: "toggle-manual" });
            el.manualToggle.focus();
        }
    });
    el.similar.addEventListener("click", () => post({ type: "similar" }));
    el.demo.addEventListener("click", () => post({ type: "demo" }));

    /** Goes to the group at `index` (wrapping around), selecting it on the board. */
    const goTo = (index: number) => {
        const { clusters } = state;
        if (clusters.length === 0) return;
        const target = clusters[((index % clusters.length) + clusters.length) % clusters.length];
        dispatch({ type: "current-group", frameId: target.frameId });
        post({ type: "go-to-group", frameId: target.frameId });
    };
    const step = (by: number) => {
        const at = state.clusters.findIndex((c) => c.frameId === state.currentGroup);
        goTo(at < 0 ? (by > 0 ? 0 : state.clusters.length - 1) : at + by);
    };
    el.groupsToggle.addEventListener("click", () => dispatch({ type: "toggle-groups" }));
    el.groupPrev.addEventListener("click", () => step(-1));
    el.groupNext.addEventListener("click", () => step(1));
    el.setupButton.addEventListener("click", () => {
        dispatch({ type: "download" });
        post({ type: "download" });
    });

    render(null, state);
    return { dispatch };
};
