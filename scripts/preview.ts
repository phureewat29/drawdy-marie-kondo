/**
 * Serves the marketplace build from `npm run check` on the same endpoints as
 * the dev server, so Drawdy loads exactly what would be published.
 *
 * Usage: node scripts/preview.ts [port]   (default 5174)
 * Then in Drawdy: ⌘K → "Add extension dev server" → localhost:<port>
 */

import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const port = Number(process.argv[2] ?? 5174);
const { driverId } = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as { driverId: string };
const file = join(ROOT, "dist/marketplace", `${driverId.replaceAll(".", "-")}.drawdyx`);

createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "no-store");
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
        if (path === "/version") {
            res.setHeader("content-type", "application/json");
            return res.end(JSON.stringify({ version: Math.floor(statSync(file).mtimeMs) }));
        }
        if (path === "/built.drawdyx") {
            res.setHeader("content-type", "application/zip");
            return res.end(readFileSync(file));
        }
        res.statusCode = 404;
        return res.end();
    } catch {
        res.statusCode = 503;
        return res.end("Run `npm run check` first.");
    }
}).listen(port, () => {
    console.log(`Serving ${file.slice(ROOT.length + 1)} on http://localhost:${port}`);
    console.log(`In Drawdy: ⌘K → "Add extension dev server" → localhost:${port}`);
});
