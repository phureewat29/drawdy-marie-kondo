import type { WebviewConfig } from "../shared/protocol.ts";
import { createEngine } from "../webview/engine.ts";
import { webviewMain } from "../webview/main.ts";
import { PANEL_BODY, PANEL_CSS } from "../webview/markup.ts";
import { createPanel } from "../webview/panel.ts";

/**
 * Makes a script safe to inline in <script>: nothing in it may close the
 * element or open the HTML parser's escaped-script states.
 */
const inlineSafe = (js: string): string =>
    js
        .replace(/<\/script/gi, "<\\/script")
        .replace(/<!--/g, "\\x3C!--")
        .replace(/<script/gi, "\\x3Cscript");

/**
 * The webview's script: each webview function is serialized on its own and
 * wired together by `webviewMain`. Writing the webview as typed functions
 * (rather than a separate bundle) keeps the extension a single plain build,
 * which is what Drawdy's marketplace pipeline produces.
 *
 * `importModule` is plain text on purpose: compilers rewrite `import()` in
 * compiled code with helpers that would not exist in the webview.
 */
export const webviewScript = (config: WebviewConfig): string =>
    [
        "const importModule = (url) => import(url);",
        `const createEngine = ${createEngine.toString()};`,
        `const createPanel = ${createPanel.toString()};`,
        `(${webviewMain.toString()})(${JSON.stringify(config)}, { createEngine, createPanel, importModule });`,
    ].join("\n");

export const webviewHtml = (themeCss: string, config: WebviewConfig): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style id="theme">:root{${themeCss}}</style>
<style>${PANEL_CSS}</style>
</head>
<body>
${PANEL_BODY}
<script type="module">${inlineSafe(webviewScript(config))}</script>
</body>
</html>`;
