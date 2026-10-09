import { union } from "../../lib/layout.ts";
import { dot, mean, normalize, standouts, topK } from "../../lib/vectors.ts";
import { readSelectedItems, type BoardItem } from "../board.ts";
import { readable } from "../embeddings.ts";
import { focus, STYLE_PANEL_WIDTH } from "../camera.ts";
import type { Context } from "../context.ts";

/**
 * "Says the same thing", on sentence-similarity embeddings: a match must
 * clear an absolute floor and stand out from the rest of the board.
 * Calibrated on hand-labelled pairs from the demo board (see README).
 */
const MATCH = { floor: 0.84, zScore: 1.5, max: 24 };
/** How many of the closest notes to point at when none clearly matches. */
const NEAREST = 3;

const percent = (score: number) => `${Math.round(score * 100)}%`;

/**
 * Find similar: selects every note that says what the selected notes say,
 * marking how close each one is. When nothing clearly matches, it points at
 * the closest notes instead of coming back empty-handed.
 */
export const findSimilar = async (ctx: Context): Promise<void> => {
    const seeds = await readSelectedItems(ctx.ddp, ctx.board.items);
    if (seeds.length === 0) return ctx.notify("Select a note first, then find similar ones.", "info");

    const seedIds = new Set(seeds.map((s) => s.id));
    const withImages = seeds.some((s) => s.kind === "image") || ctx.engine.hasVision();
    const pool = (await ctx.board.items()).filter((i) => !seedIds.has(i.id) && (withImages || i.kind !== "image"));
    if (pool.length === 0) return ctx.notify("There is nothing else on the board to compare with.", "info");

    try {
        ctx.busy("Finding similar notes…");
        const seedVectors = readable(seeds, await ctx.embeddings.items("similarity", seeds)).vectors;
        if (seedVectors.length === 0) return ctx.notify("Janitor couldn't read the selected image.", "error");
        const query = normalize(mean(seedVectors));
        // Items that cannot be read (a broken image) are left out.
        const { items: candidates, vectors } = readable(
            pool,
            await ctx.embeddings.items("similarity", pool, (fraction) => ctx.busy("Finding similar notes…", fraction))
        );
        const scores = vectors.map((v) => dot(query, v));
        const matches = standouts(scores, MATCH);
        const shown = (matches.length > 0 ? matches : topK(scores, NEAREST)).map((i) => ({
            item: candidates[i],
            score: scores[i],
        }));

        await ctx.highlight.show(shown.map(({ item, score }) => ({ rect: item.rect, label: percent(score) })));
        // The selection keeps Drawdy's style panel open on the left; stay
        // clear of it, and far enough out to show the matches in context.
        await focus(ctx.ddp, union([...seeds, ...shown.map((s) => s.item)].map((i: BoardItem) => i.rect)), {
            maxZoom: 0.8,
            left: STYLE_PANEL_WIDTH,
        });
        if (matches.length === 0) {
            return ctx.notify(`Nothing says quite the same thing. Marked the ${shown.length} closest notes.`, "info");
        }
        await ctx.ddp.call("command:scene:set-selection", {
            drawdyElementIds: [...seedIds, ...shown.map((s) => s.item.id)],
        });
        ctx.notify(`Selected ${shown.length} similar ${shown.length === 1 ? "note" : "notes"}.`, "success");
    } finally {
        ctx.busy(null);
    }
};
