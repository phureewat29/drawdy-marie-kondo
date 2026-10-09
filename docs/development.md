# Marie Kondo: developer guide

How Marie Kondo works, how to run it locally, and how to publish it. For what
it does and how to use it, see the [README](../README.md).

## Permissions

| Permission | Why Marie Kondo asks |
| --- | --- |
| `dom` | Shows the panel, its button and the right-click menu. |
| `scene` | Reads note text, moves notes into groups and frames, highlights results, sets the selection. |
| `storage` | Keeps the one-time download on your device. If you deny it, everything still works, but the download repeats each session. |

## Privacy

Everything runs locally. The only network requests download pinned, public
files once:

- the language model, from Hugging Face, at a fixed version
- its runtime, from jsDelivr, checked against a pinned SHA-256

No note, image or search ever leaves your browser.

## Test locally

You need neither an account nor a review to run Marie Kondo locally:

1. **Develop with hot reload.** Run `npm run dev`, open a **local** board on
   drawdy.io (development links are disabled on cloud boards), press `⌘K`, run
   **Add extension dev server** and enter `localhost:5173`. Drawdy reloads the
   extension on every save, which closes the panel: click the sparkles button
   to open the new version. The first time, Chrome may ask whether drawdy.io
   may reach your local network; allow it, and allow the permissions Drawdy
   asks for when the panel first opens.
2. **Set it up once.** The panel first asks to download the model: press
   **Download (235 MB)**. It comes from Hugging Face and jsDelivr and is kept
   in your browser for drawdy.io, so later reloads skip this step. Then press
   **Try with sample notes** and **Group**, search, and **Find similar**.
3. **Check the marketplace build.** The marketplace rebuilds your GitHub repo
   with esbuild and rejects anything but `@drawdy/driver-protocol` imports and
   bundles over 1 MB. `npm run check` reproduces that build, enforces both
   rules, and boots the bundle in a fake Drawdy host to make sure the panel
   starts.
4. **Run what will ship.** `npm run preview` serves the exact artifact from
   step 3 on `localhost:5174`. In `⌘K`, run **Remove extension dev server**
   for `localhost:5173`, then add `localhost:5174`: both have the same
   extension id, so only one should be added at a time.
5. **Start fresh.** Removing the dev server forgets its permission answers,
   but not its storage, so the download stays. To see the first-run screen
   again, run this in the drawdy.io tab's DevTools console (it deletes only
   Marie Kondo's entries, not your boards), then reload:

   ```js
   const db = await new Promise((ok) => (indexedDB.open("drawdy-driver-kv").onsuccess = (e) => ok(e.target.result)));
   const tx = db.transaction("kv", "readwrite");
   tx.objectStore("kv").getAll().onsuccess = (e) =>
       e.target.result.filter((r) => r.driverId === "a.marie-kondo").forEach((r) => tx.objectStore("kv").delete(r.id));
   ```

Teammates and outside collaborators test the same way from a clone of the repo.

## How it works

```
drawdy.io
├── extension host: sandboxed iframe → blob: worker
│     Marie Kondo driver (src/index.ts, src/driver/)
│     reads the board, groups, lays out, animates, caches model files
│                 ▲ messages, checked at runtime (src/shared/protocol.ts)
│                 ▼
└── Marie Kondo webview: sandboxed srcdoc iframe
      panel UI + embedding model on WebGPU (src/webview/)
```

**Model.** [EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2)
by Google DeepMind, as the 4-bit ONNX build
`onnx-community/embeddinggemma-2-ONNX` on transformers.js 4.3.1. The text
model (175 MB) loads first; the vision encoder (+109 MB) only when images are
involved. Text gets EmbeddingGemma's task prompts (`task: clustering`,
`task: search result`, …); images go in as they are.

**Why the model lives in the webview.** Drawdy starts drivers from `blob:null`
URLs, which browsers do not treat as secure contexts, so drivers get no
WebGPU. Webviews are secure contexts and do. Without WebGPU, the engine falls
back to WebAssembly.

**Caching.** Both sandboxes have opaque origins, so neither has a Cache API or
IndexedDB. The driver keeps model files in Drawdy's `kv-storage` (IndexedDB on
Drawdy's origin, which accepts Blobs) and hands them back to the webview.

**Grouping** (`src/lib/`):

1. Each note is embedded twice, with the *clustering* and the
   *classification* prompt. Both views are centered (short notes share a large
   common component) and joined.
2. Self-tuning spectral clustering (Zelnik-Manor & Perona) forms the groups;
   the silhouette score picks how many (3 to 8) unless you choose.
3. Group names come from the notes: keyphrases found with `Intl.Segmenter`
   (so Thai and Japanese work), ranked c-TF-IDF style, preferring short phrases
   several notes share and skipping words too general to name a group
   ("new", "week"); the model picks the one closest to its group and
   furthest from the others. Names keep the notes' spelling (*CI*, *Slack*).
4. Photos are grouped by their image embeddings and named from a list of
   about 150 everyday concepts (*Pizza*, *Payment terminals*, *Mountains*),
   embedded as search queries: EmbeddingGemma puts images and text in one
   space. A photo group joins a note group only when searching the notes for
   its concepts is a clear hit (a score of 0.755, calibrated offline on three
   boards and 31 photos); otherwise it stays a group of its own. Images go in
   at 70 soft tokens rather than the default 280, which kept the same groups
   and names offline at about a fifth of the cost (about 0.3 s a photo on an
   Apple M3).
5. Groups become frames placed in free space (or where the regrouped frames
   were), items packed in rows at their own sizes. Notes glide in with
   Drawdy's preview transforms, which record nothing; the final positions
   and frames then land in a single update.

Spectral clustering needs only the top eigenvectors, so Marie Kondo finds them
with a randomized block Krylov method in O(n²) per step rather than a full
O(n³) eigendecomposition: grouping 1,000 notes takes about 0.6 seconds of CPU
on an Apple M3.

Clustering was tuned offline on hand-labelled note sets with the same model:
app feedback, a city-ideas board, and the sample retro. On the sample retro
(108 notes, nine themes) the groups match the intended themes with an
adjusted Rand index of 0.54, against 0.41 on the others. The "Find similar"
threshold was calibrated the same way.

## Development

```bash
npm install
npm run dev          # dev server with hot reload (see "Test locally")
npm test             # Jest: pure core and the panel, in jsdom
npm run typecheck
npm run build        # dist/a-marie-kondo.drawdyx
npm run check        # reproduce the marketplace build
npm run preview      # serve the marketplace build to Drawdy
npm run icons        # regenerate src/shared/icons.ts from lucide-static
```

```
src/
  index.ts             driver entry: activate / onEvent
  driver/              board reading, actions, camera, motion, model cache
  webview/             panel and embedding engine: self-contained functions
                       the driver serializes into the webview
  shared/              driver ⇄ webview protocol, Lucide icons
  lib/                 pure functional core: vectors, clustering, labels,
                       layout, plus small fp and guard helpers
scripts/               marketplace check, preview server, icon generator
docs/                  this guide; notes for the Drawdy team
.github/assets/        README media (linked by absolute URL: the listing
                       does not resolve relative paths)
```

**Code style.** Functional TypeScript: a pure core in `src/lib/`, factory
functions and closures instead of classes, and imperative code only at the
edges (message wiring, DOM, numeric inner loops). The marketplace allows no npm
imports at runtime, so `lib/fp.ts` (es-toolkit-style helpers), `lib/guard.ts`
(zod-style runtime guards with inferred types) and the generated Lucide icons
are local. Relative imports use `.ts` extensions, so scripts and tests run on
Node 24 without a build step.

## Publishing

- `driverId` must be namespaced and must not use the reserved `drawdy.`
  prefix; this repo uses `a.marie-kondo`.
- Run `npm run check`, push, then `drawdy login` and `drawdy submit`; follow
  progress with `drawdy submissions`. See the `drawdy-cli` README in
  [drawdy-driver-protocol](https://github.com/drawdyio/drawdy-driver-protocol).

## Limitations

- Fastest with WebGPU (Chrome or Edge 113+, Safari 26+, Firefox 141+ on
  Windows); other browsers use a slower fallback.
- The first run downloads about 235 MB, plus 109 MB the first time images are
  grouped.
- Photo groups are named from a fixed list of everyday concepts in English,
  so unusual subjects get the nearest general name. Images that can't be read
  (a broken link) stay where they are.
- Grouping short notes is approximate. If the automatic grouping is off, pick
  the number of groups yourself, or undo in Drawdy.
- **Mixed languages.** The model's grouping prompts carry some language
  signal, so a short note in another language sometimes joins a group for how
  it is phrased rather than what it is about (one of seven in a multilingual
  test retro). Search and Find similar are not affected.
- **Undo steps.** Drawdy records a grouping in steps. After a grouping, the
  first Undo puts the notes back; after a regroup, it first brings back the
  frames that were replaced, and the second puts the notes back. Each new
  frame then takes one more Undo, because Drawdy records every frame an
  extension adds as a step of its own ([details](drawdy-host-notes.md)).
- Groups up to 1,000 notes at a time.

## Status

Verified in Chrome 154 (Apple M3, WebGPU): grouping notes, photos, and both
together into named frames, regrouping frames in place, search by meaning across English, Thai and
Japanese, find similar, sample notes, the one-time download and its reuse
after reloads, and `npm run check`.
Not yet verified: Safari, Firefox, and Drawdy's light theme.

## Credits

- [EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2) by Google
  DeepMind, Apache 2.0
- [transformers.js](https://github.com/huggingface/transformers.js) by
  Hugging Face, Apache 2.0, and [ONNX Runtime Web](https://onnxruntime.ai), MIT
- [Lucide](https://lucide.dev) icons, ISC

Marie Kondo is MIT licensed.
