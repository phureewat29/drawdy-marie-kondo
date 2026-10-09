import type { SubscribeableKey, SubscribedDrawdyElement } from "@drawdy/driver-protocol";
import { isDefined, truncate } from "../lib/fp.ts";
import type { Rect } from "../lib/layout.ts";
import type { ClusterSummary, ItemKind } from "../shared/protocol.ts";
import type { Ddp } from "./ddp.ts";

/** Meta key on the frames Sensemaker creates. */
export const MARK = "sensemaker";

/** Anything on the board Sensemaker can read: notes, text, labelled shapes, images. */
export type BoardItem = {
    id: string;
    kind: ItemKind;
    /** Empty for images. */
    text: string;
    rect: Rect;
    locked: boolean;
    /** The frame it belongs to, if any. */
    frameId: string | null;
};

const PROPERTIES = [
    "type",
    "componentType",
    "text",
    "x",
    "y",
    "width",
    "height",
    "locked",
    "frameId",
    "meta",
] as const satisfies readonly SubscribeableKey[];

const kindOf = (element: SubscribedDrawdyElement, text: string): ItemKind | null => {
    if (element.type === "image") return "image";
    if (!text) return null;
    if (element.type === "text") return "text";
    if (element.type === "path") return element.componentType === "sticky-note" ? "note" : "shape";
    return null;
};

const toBoardItem = (element: SubscribedDrawdyElement): BoardItem | null => {
    if (element.meta?.[MARK]) return null;
    const text = (element.text ?? "").trim();
    const kind = kindOf(element, text);
    if (!kind) return null;
    const { x = 0, y = 0, width = 0, height = 0 } = element;
    return {
        id: element.id,
        kind,
        text,
        rect: { x, y, width, height },
        locked: element.locked ?? false,
        frameId: element.frameId ?? null,
    };
};

/** The board's items, or just those among `ids`. */
const readItems = async (ddp: Ddp, ids?: readonly string[]): Promise<BoardItem[]> => {
    if (ids?.length === 0) return [];
    const { drawdyElements } = await ddp.call("command:scene:get-drawdy-elements", {
        properties: [...PROPERTIES],
        ...(ids ? { drawdyElementIds: [...ids] } : {}),
    });
    return drawdyElements.map(toBoardItem).filter(isDefined);
};

/** How long a board read may be reused even without a change event. */
const SNAPSHOT_MAX_AGE_MS = 10_000;

export type BoardCache = {
    /** The board's items, reused until the board changes. */
    items: () => Promise<BoardItem[]>;
    /** Call on any scene change. */
    invalidate: () => void;
};

/**
 * One board read shared by everything that needs the whole board, so typing
 * a search does not re-read every element on each keystroke.
 */
export const createBoardCache = (ddp: Ddp): BoardCache => {
    let snapshot: { at: number; items: Promise<BoardItem[]> } | null = null;
    return {
        items: () => {
            if (!snapshot || Date.now() - snapshot.at > SNAPSHOT_MAX_AGE_MS) {
                const items = readItems(ddp);
                const taken = { at: Date.now(), items };
                snapshot = taken;
                items.catch(() => {
                    if (snapshot === taken) snapshot = null;
                });
            }
            return snapshot.items;
        },
        invalidate: () => {
            snapshot = null;
        },
    };
};

export const readSelection = async (ddp: Ddp): Promise<string[]> =>
    (await ddp.call("command:scene:get-current-selected-drawdy-elements")).drawdyElementIds;

/**
 * The selected items, where a selected frame stands for the items inside it:
 * selecting last time's groups and pressing Group regroups their notes.
 * `everything` reads the whole board when a frame is selected; pass a
 * cached read where a slightly older one will do.
 */
export const readSelectedItems = async (
    ddp: Ddp,
    everything: () => Promise<BoardItem[]> = () => readItems(ddp)
): Promise<BoardItem[]> => {
    const selected = await readSelection(ddp);
    if (selected.length === 0) return [];
    const { drawdyElements } = await ddp.call("command:scene:get-drawdy-elements", {
        properties: ["type"],
        drawdyElementIds: selected,
    });
    const frames = new Set(drawdyElements.filter((e) => e.type === "frame").map((e) => e.id));
    if (frames.size === 0) return readItems(ddp, selected);
    const chosen = new Set(selected);
    return (await everything()).filter((i) => chosen.has(i.id) || (i.frameId !== null && frames.has(i.frameId)));
};

/** A frame from a grouping, with what it takes to make it again. */
export type GroupFrame = { id: string; rect: Rect; label: string };

/**
 * The frames from an earlier grouping that moving `items` out would leave
 * empty. Regrouping their notes replaces them, so they can go.
 */
export const framesLeftEmpty = async (ddp: Ddp, items: readonly BoardItem[]): Promise<GroupFrame[]> => {
    const parents = [...new Set(items.map((i) => i.frameId).filter(isDefined))];
    if (parents.length === 0) return [];
    const moving = new Set(items.map((i) => i.id));
    const [{ drawdyElements: frames }, { drawdyElements: all }] = await Promise.all([
        ddp.call("command:scene:get-drawdy-elements", {
            properties: ["x", "y", "width", "height", "meta"],
            drawdyElementIds: parents,
        }),
        ddp.call("command:scene:get-drawdy-elements", { properties: ["frameId"] }),
    ]);
    const keptIn = new Set(all.filter((e) => !moving.has(e.id)).map((e) => e.frameId));
    return frames
        .filter((f) => f.meta?.[MARK] === "frame" && !keptIn.has(f.id))
        .map(({ id, x = 0, y = 0, width = 0, height = 0, meta }) => ({
            id,
            rect: { x, y, width, height },
            label: String(meta?.label ?? ""),
        }));
};

/**
 * How many items the board has, the text of its notes, and its groups: the
 * frames Sensemaker made, in reading order (top to bottom, then left to
 * right), each with how many items it holds now. Groups the user emptied are
 * left out. The full read asks for no geometry, which Drawdy would compute
 * for every element; only the group frames are measured.
 */
export const readBoardSummary = async (
    ddp: Ddp
): Promise<{ items: number; groups: ClusterSummary[]; texts: string[] }> => {
    const { drawdyElements } = await ddp.call("command:scene:get-drawdy-elements", {
        properties: ["type", "componentType", "text", "meta", "frameId"],
    });
    const items = drawdyElements.map(toBoardItem).filter(isDefined);
    const texts = items.filter((i) => i.kind !== "image").map((i) => i.text);
    const perFrame = items.reduce(
        (counts, i) => (i.frameId ? counts.set(i.frameId, (counts.get(i.frameId) ?? 0) + 1) : counts),
        new Map<string, number>()
    );
    const frames = drawdyElements.filter(
        (e) => e.type === "frame" && e.meta?.[MARK] === "frame" && (perFrame.get(e.id) ?? 0) > 0
    );
    if (frames.length === 0) return { items: items.length, groups: [], texts };
    const { rects } = await ddp.call("command:scene:element-rects", { drawdyElementIds: frames.map((f) => f.id) });
    const at = new Map(rects.map((r) => [r.drawdyElementId, r.rect]));
    const groups = frames
        .filter((f) => at.has(f.id))
        .toSorted((a, b) => at.get(a.id)!.y - at.get(b.id)!.y || at.get(a.id)!.x - at.get(b.id)!.x)
        .map((f) => ({ frameId: f.id, label: String(f.meta?.label ?? "Group"), count: perFrame.get(f.id)! }));
    return { items: items.length, groups, texts };
};

/**
 * What makes notes copies of each other: the same text, ignoring case and
 * spacing. Copies are grouped and listed as one note; images are their own.
 */
export const noteKey = (item: BoardItem): string =>
    item.kind === "image" ? `image\u0000${item.id}` : item.text.replace(/\s+/g, " ").trim().toLowerCase();

/** One line describing an item, for result lists. */
export const describeItem = (item: BoardItem, max = 120): string =>
    item.kind === "image" ? "Image" : truncate(item.text.replace(/\s+/g, " "), max);
