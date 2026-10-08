import type { Rect } from "../lib/layout.ts";
import type { Ddp } from "./ddp.ts";

/**
 * Screen space Drawdy's own UI covers: the Sensemaker panel on the right, the
 * toolbar on top, and (while something is selected) the style panel on the
 * left.
 */
const PANEL_WIDTH = 340;
export const STYLE_PANEL_WIDTH = 270;
const TOOLBAR_HEIGHT = 72;
const MARGIN = 48;
/** Below this much free width or height, UI is covered rather than avoided. */
const MIN_FREE = 200;

/**
 * Flies the camera so `rect` fills the screen space left free by Drawdy's
 * toolbar and the Sensemaker panel, instead of hiding under them. On small
 * windows, where avoiding them would leave no room, `rect` goes under them.
 */
export const focus = async (
    ddp: Ddp,
    rect: Rect,
    options: { maxZoom?: number; durationMs?: number; left?: number } = {}
) => {
    const { maxZoom = 1, durationMs = 600 } = options;
    const screen = await ddp.tryCall("command:dom:window-size");
    const width = screen?.width ?? 1280;
    const height = screen?.height ?? 800;
    const fits = (covered: number, size: number) => size - covered - 2 * MARGIN >= MIN_FREE;
    const left = fits((options.left ?? 0) + PANEL_WIDTH, width) ? (options.left ?? 0) : 0;
    const right = fits(left + PANEL_WIDTH, width) ? PANEL_WIDTH : 0;
    const top = fits(TOOLBAR_HEIGHT, height) ? TOOLBAR_HEIGHT : 0;
    const freeWidth = Math.max(width - left - right - 2 * MARGIN, 1);
    const freeHeight = Math.max(height - top - 2 * MARGIN, 1);
    const zoom = Math.min(maxZoom, freeWidth / Math.max(rect.width, 1), freeHeight / Math.max(rect.height, 1));
    // Padding in canvas units, so fitting the padded rect leaves `rect`
    // exactly in the free area.
    const padded: Rect = {
        x: rect.x - (left + MARGIN) / zoom,
        y: rect.y - (top + MARGIN) / zoom,
        width: rect.width + (left + right + 2 * MARGIN) / zoom,
        height: rect.height + (top + 2 * MARGIN) / zoom,
    };
    await ddp.tryCall("command:camera:fly-to-rect", { rect: padded, flyDurationMs: durationMs, zoom: maxZoom });
};
