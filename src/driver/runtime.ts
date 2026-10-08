import type { DriverModule, DriverSubscriptionEvent } from "@drawdy/driver-protocol";
import { debounce, serial } from "../lib/fp.ts";
import { ICONS } from "../shared/icons.ts";
import type { ClusterSummary } from "../shared/protocol.ts";
import { clusterSelection } from "./actions/cluster.ts";
import { addDemo } from "./actions/demo.ts";
import { createSearch } from "./actions/search.ts";
import { findSimilar } from "./actions/similar.ts";
import { createBoardCache, readBoardSummary, readSelectedItems, readSelection } from "./board.ts";
import { focus, STYLE_PANEL_WIDTH } from "./camera.ts";
import { createChannel } from "./channel.ts";
import type { Action, Context } from "./context.ts";
import { createDdp, explain, protocolError } from "./ddp.ts";
import { createEmbeddings } from "./embeddings.ts";
import { createEngineClient } from "./engine-client.ts";
import { createHighlighter } from "./highlight.ts";
import { MENU, actionForMenu, leafIds } from "./menu.ts";
import { kvModelStore, kvSetupFlag } from "./model-store.ts";

const ACTION_BUTTON_ID = "sensemaker:open";
/** Lucide "sparkles", tinted to stand out among Drawdy's monochrome buttons. */
const ACTION_BUTTON_SVG = ICONS.sparkles
    .replace('stroke="currentColor"', 'stroke="#b69cff"')
    .replace('class="icon"', 'width="18" height="18"');

export type Runtime = {
    /** Registers Sensemaker's button, menu and subscriptions. */
    start: () => Promise<void>;
    handle: (event: DriverSubscriptionEvent) => Promise<void>;
};

/** When to retry registering UI the user has not granted yet (see `start`). */
const REGISTER_RETRIES_MS = [800, 2000, 4000, 8000, 15000];

const UNREADABLE =
    "Sensemaker can't read this board without permission. Turn it on in Extensions › Sensemaker › Manage permissions.";

/** Runs `step`, reporting whether it worked; failures are logged, not thrown. */
const attempt = (label: string, step: () => Promise<unknown>): Promise<boolean> =>
    step().then(
        () => true,
        (err: unknown) => {
            console.warn(`[sensemaker] ${label} unavailable: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    );

export const createRuntime = (args: Parameters<DriverModule["activate"]>[0]): Runtime => {
    const ddp = createDdp(args.issueCommand, args.manifest.driverId);
    let styling = args.styling;
    const channel = createChannel({ ddp, styling: () => styling });
    const engine = createEngineClient({ channel, store: kvModelStore(ddp) });
    const ctx: Context = {
        ddp,
        generateId: args.generateId,
        styling: () => styling,
        channel,
        board: createBoardCache(ddp),
        engine,
        embeddings: createEmbeddings({ ddp, engine }),
        highlight: createHighlighter({ ddp, generateId: args.generateId, color: () => styling.primary }),
        tell: channel.post,
        notify: (text, tone) => channel.post({ type: "notice", text, tone }),
        busy: (text, progress) => channel.post({ type: "busy", text, progress }),
    };
    const search = createSearch(ctx);

    // The panel's counts. The selection is recounted when it changes; the
    // total, which reads every element, only when elements come and go.
    let counts: { items: number; selected: number; single?: string } = { items: 0, selected: 0 };
    let toldDenied = false;
    const report = (next: Partial<typeof counts>) => {
        counts = { ...counts, ...next };
        ctx.tell({ type: "board", ...counts });
    };
    const unreadable = (err: unknown) => {
        if (protocolError(err)?.type !== "unauthorized" || toldDenied) return;
        toldDenied = true;
        ctx.notify(UNREADABLE, "error");
    };
    // A lone selected element tells the panel which group the user is on
    // when it is a group's frame, so the arrows carry on from there.
    const recountSelection = debounce(() => {
        Promise.all([readSelection(ddp), readSelectedItems(ddp, ctx.board.items)]).then(([ids, selected]) => {
            report({ selected: selected.length, single: ids.length === 1 ? ids[0] : undefined });
        }, unreadable);
    }, 120);
    // The panel's group list is the board's: every group Sensemaker made, as
    // it is now. Groups Drawdy's undo or the user emptied drop out, and come
    // back on redo.
    let legend: ClusterSummary[] = [];
    const showLegend = (next: ClusterSummary[]) => {
        const same =
            next.length === legend.length &&
            next.every((c, i) => c.frameId === legend[i].frameId && c.label === legend[i].label && c.count === legend[i].count);
        legend = next;
        if (!same) ctx.tell({ type: "clusters", clusters: next });
    };
    const recountBoard = debounce(() => {
        readBoardSummary(ddp).then(({ items, groups }) => {
            report({ items });
            showLegend(groups);
        }, unreadable);
    }, 400);

    // Scene subscriptions start with the panel, so Drawdy asks for the scene
    // permission when the user first opens Sensemaker, not on page load.
    let watching = false;
    const watchBoard = async () => {
        if (watching) return;
        watching = true;
        await ddp.tryCall("subscription:scene:drawdy-element-selection");
        await ddp.tryCall("subscription:scene:elements-added", { properties: ["type"] });
        await ddp.tryCall("subscription:scene:elements-removed", { properties: ["type"] });
        await ddp.tryCall("subscription:scene:elements-updated", { properties: ["type"] });
        await ddp.tryCall("subscription:scene:elements-replaced", { properties: ["type"] });
        recountSelection();
        recountBoard();
    };

    // The model downloads only once the user agrees to it in the panel;
    // after that, this device remembers, and later sessions load it at once.
    const setupFlag = kvSetupFlag(ddp);
    let setupDone: boolean | null = null;

    const openPanel = async () => {
        await channel.open();
        await watchBoard();
        setupDone ??= await setupFlag.isDone();
        ctx.tell({ type: "setup", needed: !setupDone });
        if (setupDone) void engine.warmUp();
    };

    /** Opens the panel; false (with a word why) until the one-time download is done. */
    const ready = async () => {
        await openPanel();
        if (!setupDone) ctx.notify("Sensemaker needs its one-time download first. Choose Download above.", "info");
        return setupDone === true;
    };

    /**
     * Shows a group and selects its frame, which stands for the items in it:
     * Group regroups them, Find similar looks for what they say. Selecting
     * opens Drawdy's style panel on the left, so the camera keeps clear of it.
     */
    const goToGroup = async (frameId: string) => {
        const found = await ddp.call("command:scene:element-rects", { drawdyElementIds: [frameId] });
        const rect = found.rects[0]?.rect;
        if (!rect) return;
        await ddp.call("command:scene:set-selection", { drawdyElementIds: [frameId] });
        await focus(ddp, rect, { durationMs: 450, left: STYLE_PANEL_WIDTH });
    };

    const safely = async (job: () => Promise<unknown>) => {
        try {
            await job();
        } catch (err) {
            console.error("[sensemaker]", err);
            ctx.notify(explain(err), "error");
        }
    };

    // Actions that change the board run one at a time: two groupings must
    // never interleave. Opening the panel never waits behind them.
    const queue = serial();
    const perform = (action: Action): Promise<void> => {
        switch (action.type) {
            case "open-panel":
                return safely(openPanel);
            case "cluster":
                return queue(() =>
                    safely(async () => {
                        if (!(await ready())) return;
                        await clusterSelection(ctx, action.k);
                    })
                );
            case "similar":
                return queue(() =>
                    safely(async () => {
                        if (await ready()) await findSimilar(ctx);
                    })
                );
            case "demo":
                return queue(() => safely(() => addDemo(ctx)));
        }
    };

    channel.subscribe((message) => {
        const recover = (err: unknown) => ctx.notify(explain(err), "error");
        switch (message.type) {
            case "ready":
                if (setupDone !== null) ctx.tell({ type: "setup", needed: !setupDone });
                if (legend.length > 0) ctx.tell({ type: "clusters", clusters: legend });
                recountSelection();
                return recountBoard();
            case "search":
                return void search.search(message.query).catch(recover);
            case "hover":
                return void search.hover(message.id).catch(recover);
            case "reveal":
                return void search.reveal(message.id).catch(recover);
            case "cluster":
                return void perform(message.k === undefined ? { type: "cluster" } : { type: "cluster", k: message.k });
            case "similar":
                return void perform({ type: "similar" });
            case "demo":
                return void perform({ type: "demo" });
            case "download":
                return void engine.warmUp();
            case "engine-state":
                // The first time the model is ready, the one-time setup is done.
                if (message.state.phase !== "ready" || setupDone !== false) return;
                setupDone = true;
                ctx.tell({ type: "setup", needed: false });
                return void setupFlag.markDone();
            case "go-to-group":
                return void goToGroup(message.frameId).catch(recover);
            default:
                return;
        }
    });

    // The button and the menu spend the dom permission, which on install is
    // granted only after activation: retry them until it lands. Nothing here
    // may reject `activate`, or Drawdy fails the install.
    const registered = { button: false, menu: false };
    const registerUi = async () => {
        registered.button ||= await attempt("panel button", () =>
            ddp.call("command:dom:create-action-button", { domElementId: ACTION_BUTTON_ID, svg: ACTION_BUTTON_SVG })
        );
        registered.menu ||= await attempt("menu", () => ddp.call("command:context-menu:add", MENU));
    };

    const start = async () => {
        // Subscriptions only need their permission declared, not granted.
        await attempt("subscriptions", async () => {
            await ddp.call("subscription:dom:element-clicked", { domElementId: ACTION_BUTTON_ID });
            await ddp.call("subscription:webview:message", { webviewDomId: channel.id });
            await ddp.call("subscription:dom:theme-changed");
            for (const menuId of leafIds(MENU)) {
                await ddp.call("subscription:context-menu:clicked", { menuId });
            }
        });
        await registerUi();
        REGISTER_RETRIES_MS.forEach((delay) =>
            setTimeout(() => {
                if (!registered.button || !registered.menu) void registerUi();
            }, delay)
        );
    };

    // Long actions are not awaited here: events keep flowing while they run.
    const handle = async (event: DriverSubscriptionEvent) => {
        switch (event.type) {
            case "subscription:dom:theme-changed":
                styling = event.body.styling;
                return channel.pushTheme();
            case "subscription:dom:element-clicked":
                if (event.body.domElementId === ACTION_BUTTON_ID) void perform({ type: "open-panel" });
                return;
            case "subscription:webview:message":
                if (event.body.webviewDomId === channel.id) channel.receive(event.body.message);
                return;
            case "subscription:context-menu:clicked": {
                const action = actionForMenu(event.body.menuId);
                if (action) void perform(action);
                return;
            }
            case "subscription:scene:drawdy-element-selection":
                if (event.body.drawdyElementIds.length === 0) void ctx.highlight.clear();
                return recountSelection();
            // Updates count too: a new note only becomes an item once it
            // has text.
            case "subscription:scene:elements-added":
            case "subscription:scene:elements-removed":
            case "subscription:scene:elements-updated":
                ctx.board.invalidate();
                recountSelection();
                return recountBoard();
            // Another board, a cleared canvas or a restored version: nothing
            // on screen is what the panel last showed.
            case "subscription:scene:elements-replaced":
                ctx.board.invalidate();
                recountSelection();
                recountBoard();
                return void search.refresh().catch(() => undefined);
            default:
                return;
        }
    };

    return { start, handle };
};
