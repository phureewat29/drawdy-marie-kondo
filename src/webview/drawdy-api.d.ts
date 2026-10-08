import type { DrawdyWebviewApi } from "@drawdy/driver-protocol";

declare global {
    /** Injected into every webview document by Drawdy at runtime. Call once. */
    function acquireDrawdyApi(): DrawdyWebviewApi;
}

export {};
