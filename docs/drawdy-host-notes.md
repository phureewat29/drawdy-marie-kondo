# Notes for the Drawdy team

Things we ran into while building Marie Kondo against the Driver Protocol
(`@drawdy/driver-protocol` 1.1 to 1.3) and drawdy.io in October 2026,
each with the smallest change that would fix it.

## 1. Let extensions name frames (done in 1.3)

Marie Kondo names each group's frame after the group ("CI", "Meetings"), but
until 1.3 every frame an extension created was called "Frame N". Protocol
1.3 and host commit `f37dafcb` fixed it: `name` on a new frame reaches
`createFrame`, and `frameName` reads and renames a frame. Marie Kondo sends
`name` on every frame it creates (`src/driver/frame.ts`), so group names
show on the board once drawdy.io runs that commit.

One follow-up: a host from before 1.3 throws `Not exhaustive` when a driver
asks `get-drawdy-elements` for a key it does not know, such as `frameName`.
Skipping unknown keys instead would let drivers adopt new readable keys
without breaking on hosts that have not deployed them yet. Until then,
Marie Kondo reads group names from its own frame `meta`, not `frameName`.

## 2. One undo step per command

Marie Kondo leaves undo to Drawdy, but a grouping takes several presses of
Undo to take back:

- `createFrame` pushes a history entry before every frame it adds, so one
  `add-drawdy-elements` call with six frames is six undo steps.
- Every other scene command (`update-drawdy-elements`,
  `remove-drawdy-elements`) seals the changes before it as a step of its own,
  so a driver cannot group several commands into one step.

Marie Kondo keeps it as short as it can: the notes' moves and frames
land in one `update-drawdy-elements`, so the first Undo puts the notes back
(after a regroup, the frames it replaced come back first), and each further
one removes a frame.

**Change:** take one history snapshot per `add-drawdy-elements` call rather
than per frame (snapshot once before the loop, and skip the push inside
`createFrame` for this path). Optionally, a pair of commands such as
`command:history:begin-group` / `end-group` would let a driver make any
sequence of commands a single undo step.

## 3. Frames an extension creates get selected

`createFrame` selects the new frame, so `add-drawdy-elements` with frames
changes the user's selection (and opens the style panel). Marie Kondo clears
the selection afterwards. **Change:** skip `selection.select` when the frame
comes from a driver, as for every other element type.

## 4. Removing an extension leaves its storage behind

Uninstalling a driver clears its permission answers
(`permissionStore.clearDriver`), but nothing deletes its records in
`drawdy-driver-kv`. For Marie Kondo that is 235 to 344 MB of model files that
stay in the user's browser after they remove it, with no way to see or free
them short of clearing all of drawdy.io's site data (which also deletes local
boards).

**Change:** delete the driver's `kv` records (all ids prefixed with
`driverId + "\u0000"`) on uninstall, as permissions already are. Keeping them
for dev-server reloads, which uninstall and reinstall the same id, would mean
skipping the cleanup for `ephemeral` installs.

## 5. WebGPU (and storage) for drivers

A driver runs in a worker created from a `blob:` URL inside a
`sandbox="allow-scripts"` iframe. Its origin is `blob:null`, which browsers do
not treat as a secure context, so drivers get no `navigator.gpu`, no Cache API
and no IndexedDB. Webviews (`srcdoc`, same sandbox) are secure contexts and do
get WebGPU, which is why Marie Kondo runs its model in its webview.

**Option:** start the host worker from a URL on a dedicated extensions origin
(for example `https://ext.drawdy.io/host-worker.js`) instead of an opaque
sandbox. Drivers would get WebGPU and a real, isolated origin for storage.

## 6. Publish `@drawdy/driver-protocol` 1.2

npm has 1.1.0. The repo's 1.2.0 adds `componentType: "sticky-note"`, which the
live app already accepts, so extensions need a cast until it is published
(`src/driver/sticky-note.ts`).

## 7. Docs

- Webviews are described as running "on a separate origin". They are `srcdoc`
  frames with `sandbox="allow-scripts"`, an opaque origin without IndexedDB or
  the Cache API. That decides where an extension can cache large files, so it
  is worth stating (kv-storage, which accepts Blobs, works well for this).
- Extension context-menu items appear under an "Extension" submenu; a line in
  the context menu docs would save a search.
- `subscription:scene:elements-updated` fires for an extension's own changes
  too, a little after its command resolves; worth a note for anyone tracking
  "the user changed something".
- A driver's webview goes when the driver does (every dev-server reload
  uninstalls it), and `webview:create` with an existing `webviewDomId` reuses
  the open webview as is. Worth a line in the webview docs, since it decides
  whether a driver must re-sync state with a webview after a reload (it need
  not).
- Commands and subscriptions that only need a permission declared (the
  `subscription:*` topics) versus those that spend it (`command:dom:*`, which
  on install can run before the grant lands) are only explained in the
  physics example; the permissions page would be the place for it.
