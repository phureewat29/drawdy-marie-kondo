import type { DrawdyPreviewElementSchema } from "@drawdy/driver-protocol";
import { serial } from "../lib/fp.ts";
import { inflate, type Rect } from "../lib/layout.ts";
import type { Ddp } from "./ddp.ts";

export type Mark = { rect: Rect; label?: string };

export type Highlighter = {
    /** Replaces the current highlights with `marks`. */
    show: (marks: readonly Mark[]) => Promise<void>;
    clear: () => Promise<void>;
};

/**
 * Sketchy outlines around items, drawn as Drawdy preview elements: they
 * render on the canvas but are never committed, synced or undoable.
 */
export const createHighlighter = (deps: { ddp: Ddp; generateId: () => string; color: () => string }): Highlighter => {
    const { ddp, generateId, color } = deps;
    const run = serial();
    let current: string | null = null;

    const elementsFor = (mark: Mark): DrawdyPreviewElementSchema[] => {
        const box = inflate(mark.rect, 10);
        const outline: DrawdyPreviewElementSchema = {
            type: "shape",
            componentType: "rect",
            drawdyElementId: generateId(),
            ...box,
            strokeColor: color(),
            fillColor: "transparent",
            strokeWidth: 3,
            roughness: 1,
            cornerRadius: 16,
        };
        if (!mark.label) return [outline];
        // Inside the outline's bottom-right corner, where notes are usually
        // empty; above it would cover the neighbouring note in a grid.
        const label: DrawdyPreviewElementSchema = {
            type: "text",
            drawdyElementId: generateId(),
            x: box.x + box.width - 64,
            y: box.y + box.height - 36,
            text: mark.label,
            fontSize: 18,
            color: color(),
        };
        return [outline, label];
    };

    const show = (marks: readonly Mark[]) =>
        run(async () => {
            const previous = current;
            current = null;
            if (marks.length > 0) {
                const created = await ddp.tryCall("command:scene:create-drawdy-preview-elements", {
                    elements: marks.flatMap(elementsFor),
                });
                current = created?.previewId ?? null;
            }
            if (previous) await ddp.tryCall("command:scene:delete-drawdy-preview-elements", { previewIds: [previous] });
        });

    return { show, clear: () => show([]) };
};
