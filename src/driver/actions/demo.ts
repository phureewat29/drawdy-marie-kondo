import type { DrawdyElementSchema } from "@drawdy/driver-protocol";
import { DEMO_NOTES } from "../../lib/demo-notes.ts";
import { rng, shuffle } from "../../lib/random.ts";
import { focus, STYLE_PANEL_WIDTH } from "../camera.ts";
import type { Context } from "../context.ts";
import { PAPERS } from "../palette.ts";
import { findFreeSpot } from "../space.ts";

const CELL = { width: 250, height: 240 };
const JITTER = 36;
/** Columns for a roughly 16:10 block of notes. */
const COLUMNS = Math.ceil(Math.sqrt((DEMO_NOTES.length * 1.6 * CELL.height) / CELL.width));

/**
 * Drops a messy sample retrospective in the middle of the view, in random
 * order and colours, and selects it so Group works straight away.
 */
export const addDemo = async (ctx: Context): Promise<void> => {
    const { rect: view } = await ctx.ddp.call("command:camera:get-viewport-rect");
    const random = rng(Date.now());
    const rows = Math.ceil(DEMO_NOTES.length / COLUMNS);
    const size = { width: COLUMNS * CELL.width, height: rows * CELL.height };
    const centered = {
        x: view.x + view.width / 2 - size.width / 2,
        y: view.y + view.height / 2 - size.height / 2,
        ...size,
    };
    const area = { ...size, ...(await findFreeSpot(ctx.ddp, centered)) };
    const jitter = () => (random() - 0.5) * 2 * JITTER;
    const notes = shuffle(DEMO_NOTES, random).map(
        (text, i): DrawdyElementSchema => ({
            type: "shape",
            componentType: "sticky-note",
            drawdyElementId: ctx.generateId(),
            x: area.x + (i % COLUMNS) * CELL.width + jitter(),
            y: area.y + Math.floor(i / COLUMNS) * CELL.height + jitter(),
            text,
            fillColor: PAPERS[Math.floor(random() * PAPERS.length)],
        })
    );
    await ctx.ddp.call("command:scene:add-drawdy-elements", { elements: notes });
    await ctx.ddp.call("command:scene:set-selection", { drawdyElementIds: notes.map((n) => n.drawdyElementId) });
    // The new notes are selected, which opens Drawdy's style panel on the left.
    await focus(ctx.ddp, area, { durationMs: 500, left: STYLE_PANEL_WIDTH });
    ctx.notify(`Added ${notes.length} sample notes and selected them. Now press Group.`, "success");
};
