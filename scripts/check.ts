/**
 * Reproduces Drawdy's marketplace build lane locally, so a submission can't
 * fail on something a dev build hides:
 *
 * 1. bundles src/index.ts with esbuild as one browser CommonJS file (ES2020);
 * 2. fails on any bare import other than `@drawdy/driver-protocol`;
 * 3. fails if the bundle reaches 1 MB;
 * 4. boots the bundle in a fake Drawdy host, opens the panel, and runs the
 *    generated webview in jsdom until it reports `ready`;
 * 5. packs dist/marketplace/<driver-id>.drawdyx (see `npm run preview`).
 *
 * Usage: node scripts/check.ts
 */

import type { DriverCommandIssuer, DriverModule, ModuleStyling } from "@drawdy/driver-protocol";
import { build, type Plugin } from "esbuild";
import { strToU8, zipSync } from "fflate";
import { JSDOM } from "jsdom";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const ALLOWED_IMPORTS = new Set(["@drawdy/driver-protocol"]);
const MAX_BUNDLE_BYTES = 1_000_000;

type Manifest = { driverId: string; main: string };
const manifestText = readFileSync(join(ROOT, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText) as Manifest;

const failures: string[] = [];
const pass = (message: string) => console.log(`  ✓ ${message}`);
const fail = (message: string) => {
    failures.push(message);
    console.log(`  ✗ ${message}`);
};

// 1-3. Build like the marketplace, recording bare imports on the way.
const bareImports = new Set<string>();
const recordBareImports: Plugin = {
    name: "record-bare-imports",
    setup: (b) =>
        b.onResolve({ filter: /^[^./]/ }, (args) => {
            bareImports.add(args.path);
            return undefined;
        }),
};
const result = await build({
    entryPoints: [join(ROOT, "src/index.ts")],
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2020",
    minify: true,
    write: false,
    logLevel: "silent",
    plugins: [recordBareImports],
});
const code = result.outputFiles[0].text;
console.log("Marketplace build (esbuild, cjs, es2020)");

const banned = [...bareImports].filter((name) => !ALLOWED_IMPORTS.has(name));
if (banned.length > 0) fail(`imports outside the whitelist: ${banned.join(", ")}`);
else pass("imports only @drawdy/driver-protocol");

const bytes = Buffer.byteLength(code);
if (bytes >= MAX_BUNDLE_BYTES) fail(`bundle is ${(bytes / 1e6).toFixed(2)} MB (limit 1 MB)`);
else pass(`bundle is ${(bytes / 1024).toFixed(1)} KB (limit 1 MB)`);

// 4. Boot it the way Drawdy's host worker does and capture the webview.
const bootAndOpenPanel = async (): Promise<string> => {
    const module = { exports: {} as Partial<DriverModule> };
    new Function("exports", "module", code)(module.exports, module);
    const { activate, onEvent } = module.exports as DriverModule;

    let webview: { id: string; html: string } | null = null;
    const answers: Record<string, unknown> = {
        "command:scene:get-drawdy-elements": { drawdyElements: [] },
        "command:scene:get-current-selected-drawdy-elements": { drawdyElementIds: [] },
        "command:webview:post-message": { posted: true },
        "command:kv-storage:get": {},
    };
    const issueCommand = (async (request: { type: string; req?: Record<string, unknown> }) => {
        if (request.type === "command:webview:create") {
            webview = { id: String(request.req?.webviewDomId), html: String(request.req?.htmlContent) };
            // Stand in for the webview announcing itself.
            setTimeout(() =>
                onEvent({
                    type: "subscription:webview:message",
                    subscriptionId: "check",
                    body: { webviewDomId: webview!.id, message: { type: "ready" } },
                })
            );
            return { ...request, res: { value: { created: true } } };
        }
        const value = request.type.startsWith("subscription:")
            ? { subscriptionId: "check" }
            : (answers[request.type] ?? {});
        return { ...request, res: { value } };
    }) as unknown as DriverCommandIssuer;

    await activate({
        issueCommand,
        manifest: { ...manifest, driverName: "check", driverVersion: "0.0.0", permissions: [] },
        styling: { theme: "dark", foreground: "#fff", primary: "#b69cff" } as ModuleStyling,
        generateId: () => crypto.randomUUID(),
    });
    await onEvent({
        type: "subscription:dom:element-clicked",
        subscriptionId: "check",
        body: { domElementId: "marie-kondo:open", clientX: 0, clientY: 0 },
    });
    if (!webview) throw new Error("opening the panel did not create a webview");
    return (webview as { html: string }).html;
};

const runWebview = async (html: string): Promise<string[]> => {
    const script = /<script type="module">([\s\S]*)<\/script>/.exec(html)?.[1];
    if (!script) throw new Error("the webview HTML has no module script");
    const dom = new JSDOM(html.replace(/<script type="module">[\s\S]*<\/script>/, ""), { runScripts: "outside-only" });
    const posted: string[] = [];
    Object.assign(dom.window, {
        acquireDrawdyApi: () => ({
            postMessage: (message: { type: string }) => posted.push(message.type),
            onMessage: () => () => undefined,
        }),
    });
    dom.window.eval(script);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return posted;
};

try {
    const html = await bootAndOpenPanel();
    pass(`driver boots in a fake host and opens a ${(html.length / 1024).toFixed(1)} KB webview`);
    const posted = await runWebview(html);
    if (posted.includes("ready")) pass("webview script runs on its own and reports ready");
    else fail(`webview never reported ready (posted: ${posted.join(", ") || "nothing"})`);
} catch (err) {
    fail(`smoke test: ${err instanceof Error ? err.message : String(err)}`);
}

// 5. Pack what the marketplace would publish.
const outDir = join(ROOT, "dist/marketplace");
const outFile = join(outDir, `${manifest.driverId.replaceAll(".", "-")}.drawdyx`);
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, zipSync({ "manifest.json": strToU8(manifestText), [manifest.main]: strToU8(code) }));
pass(`packed ${outFile.slice(ROOT.length + 1)}`);

if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed.`);
    process.exit(1);
}
console.log("\nReady to submit: git push && drawdy submit");
