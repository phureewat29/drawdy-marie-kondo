import type { ModuleStyling } from "@drawdy/driver-protocol";
import { parse } from "../lib/guard.ts";
import {
    MODEL,
    TRANSFORMERS,
    webviewToDriver,
    type DriverToWebview,
    type WebviewConfig,
    type WebviewToDriver,
} from "../shared/protocol.ts";
import { ICONS } from "../shared/icons.ts";
import type { Ddp } from "./ddp.ts";
import { webviewHtml } from "./webview-html.ts";

const WEBVIEW_ID = "janitor:panel";
/** How long a new webview gets to start its script. */
const START_TIMEOUT_MS = 20_000;

const CONFIG: WebviewConfig = {
    model: MODEL,
    transformers: TRANSFORMERS,
    icons: { note: ICONS.note, text: ICONS.text, shape: ICONS.shape, image: ICONS.image },
};

export type Channel = {
    /** The webview's DOM id. */
    id: string;
    isReady: () => boolean;
    /** Opens the panel (or brings it back) once its script is listening. */
    open: () => Promise<void>;
    /** Resolves once the webview is listening, opening it only if needed. */
    ensure: () => Promise<void>;
    post: (message: DriverToWebview) => void;
    /** Feeds in a `subscription:webview:message` body. */
    receive: (raw: unknown) => void;
    subscribe: (handler: (message: WebviewToDriver) => void) => void;
    pushTheme: () => void;
};

/**
 * ModuleStyling as `--drawdy-*` CSS variables for the webview's `:root`,
 * e.g. `mutedForeground` becomes `--drawdy-muted-foreground`.
 */
export const themeCss = (styling: ModuleStyling): string =>
    Object.entries(styling)
        .map(([key, value]) =>
            key === "theme"
                ? `color-scheme: ${value};`
                : `--drawdy-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`
        )
        .join("");

/**
 * The driver's end of the Janitor webview: creates it, waits for its
 * script to announce `ready`, queues messages until then, and checks every
 * message coming back against the protocol.
 */
export const createChannel = (deps: { ddp: Ddp; styling: () => ModuleStyling }): Channel => {
    const { ddp, styling } = deps;
    const id = WEBVIEW_ID;
    let ready = false;
    let queued: DriverToWebview[] = [];
    let waiters: (() => void)[] = [];
    let opening: Promise<void> | null = null;
    const handlers = new Set<(message: WebviewToDriver) => void>();

    const send = (message: DriverToWebview) =>
        ddp.tryCall("command:webview:post-message", { webviewDomId: id, message });

    const post = (message: DriverToWebview) => {
        if (ready) void send(message);
        else queued = [...queued, message];
    };

    const markReady = () => {
        if (ready) return;
        ready = true;
        void send({ type: "theme", css: themeCss(styling()) });
        queued.forEach((message) => void send(message));
        waiters.forEach((wake) => wake());
        queued = [];
        waiters = [];
    };

    const waitReady = () =>
        new Promise<void>((resolve, reject) => {
            if (ready) return resolve();
            const timer = setTimeout(() => reject(new Error("The Janitor panel did not start")), START_TIMEOUT_MS);
            waiters = [
                ...waiters,
                () => {
                    clearTimeout(timer);
                    resolve();
                },
            ];
        });

    // Drawdy removes a driver's webview along with the driver, so a webview
    // with this id is always this driver's own: new, or reopened after the
    // user closed the panel (it keeps its state while hidden).
    const create = async () => {
        await ddp.call("command:webview:create", {
            webviewDomId: id,
            htmlContent: webviewHtml(themeCss(styling()), CONFIG),
            keepStateWhenClosed: true,
        });
        await waitReady();
    };

    const open = () => {
        opening ??= create().finally(() => {
            opening = null;
        });
        return opening;
    };

    const receive = (raw: unknown) => {
        const message = parse(webviewToDriver, raw);
        if (!message) {
            console.warn(`[janitor] ignored a malformed webview message: ${JSON.stringify(raw)?.slice(0, 300)}`);
            return;
        }
        if (message.type === "ready") markReady();
        handlers.forEach((handler) => handler(message));
    };

    return {
        id,
        isReady: () => ready,
        open,
        ensure: async () => {
            if (!ready) await open();
        },
        post,
        receive,
        subscribe: (handler) => void handlers.add(handler),
        pushTheme: () => {
            if (ready) void send({ type: "theme", css: themeCss(styling()) });
        },
    };
};
