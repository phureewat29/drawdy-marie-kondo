import type { DrawdyElementCommon, DrawdyElementSchema, TextAlign } from "@drawdy/driver-protocol";

/**
 * A sticky note, as `@drawdy/driver-protocol` 1.2 describes it. Drawdy already
 * accepts these, but npm has only 1.1, whose `DrawdyElementSchema` predates
 * them. Drop this file once 1.2 is published.
 */
export type StickyNote = DrawdyElementCommon & {
    type: "shape";
    componentType: "sticky-note";
    x: number;
    y: number;
    /** Defaults to 200. */
    width?: number;
    /** Defaults to 193. */
    height?: number;
    /** A palette name ("blue", "lime", …) or a `#rrggbb` hex. */
    fillColor?: string;
    text?: string;
    fontSize?: number;
    textAlign?: TextAlign;
};

export const stickyNote = (note: Omit<StickyNote, "type" | "componentType">): DrawdyElementSchema =>
    ({ ...note, type: "shape", componentType: "sticky-note" }) as unknown as DrawdyElementSchema;
