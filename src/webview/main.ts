import type { DriverToWebview, WebviewConfig, WebviewToDriver } from "../shared/protocol.ts";
import type { createEngine } from "./engine.ts";
import type { createPanel } from "./panel.ts";

export type Factories = {
    createEngine: typeof createEngine;
    createPanel: typeof createPanel;
    importModule: (url: string) => Promise<unknown>;
};

/**
 * The webview's entry point: wires Drawdy's webview API to the engine and the
 * panel. The factories arrive as arguments because every function here is
 * serialized into the webview on its own (see driver/webview-html.ts).
 */
export const webviewMain = (config: WebviewConfig, { createEngine, createPanel, importModule }: Factories): void => {
    const api = acquireDrawdyApi();
    const post = (message: WebviewToDriver, transfer: Transferable[] = []) => api.postMessage(message, transfer);
    const panel = createPanel({ post, document, icons: config.icons, model: config.model.id });
    const engine = createEngine({
        config,
        post,
        importModule,
        onState: (state) => panel.dispatch({ type: "engine", state }),
    });
    const theme = document.getElementById("theme");

    const announce = () => {
        post({ type: "ready" });
        post({ type: "engine-state", state: engine.current() });
    };

    api.onMessage((raw) => {
        if (typeof raw !== "object" || raw === null || !("type" in raw)) return;
        const message = raw as DriverToWebview;
        switch (message.type) {
            case "theme":
                if (theme) theme.textContent = `:root{${message.css}}`;
                return;
            case "load":
            case "embed":
            case "cache-got":
            case "cache-put-done":
                return engine.handle(message);
            default:
                return panel.dispatch({ type: "driver", message });
        }
    });

    announce();
};
