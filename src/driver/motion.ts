import { clamp } from "../lib/fp.ts";
import type { Ddp } from "./ddp.ts";

export type Move = {
    id: string;
    to: { x: number; y: number };
    /** Stagger, so groups peel off one after another. */
    delayMs: number;
};

type Leg = Move & { from: { x: number; y: number } };

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Each leg's offset from its start at `elapsedMs` into the animation. */
const offsetsAt = (legs: readonly Leg[], elapsedMs: number, durationMs: number) =>
    legs.map((m) => {
        const e = easeInOutCubic(clamp((elapsedMs - m.delayMs) / durationMs, 0, 1));
        return { id: m.id, x: (m.to.x - m.from.x) * e, y: (m.to.y - m.from.y) * e };
    });

/**
 * Glides elements to their targets with Drawdy's preview transforms, which
 * draw locally and record nothing, then calls `land` to make it real. The
 * preview ends in the same breath as `land` starts, so no frame is drawn in
 * between, and `land` can write the final positions in one update together
 * with any other changes: one step in Drawdy's undo history.
 *
 * Elements animate from where they are when the glide begins, even if they
 * moved since `moves` was planned. Elements Drawdy will not preview (grouped
 * ones) do not animate; `land` moves them along with the rest.
 */
export const glide = async (
    ddp: Ddp,
    moves: readonly Move[],
    land: () => Promise<unknown>,
    durationMs = 650
): Promise<void> => {
    const { drawdyElements } =
        moves.length > 0
            ? await ddp.call("command:scene:get-drawdy-elements", {
                  properties: ["x", "y"],
                  drawdyElementIds: moves.map((m) => m.id),
              })
            : { drawdyElements: [] };
    const starts = new Map(drawdyElements.map((e) => [e.id, { x: e.x ?? 0, y: e.y ?? 0 }]));
    const legs = moves.flatMap((m): Leg[] => {
        const from = starts.get(m.id);
        return from ? [{ ...m, from }] : [];
    });
    const began = legs.length > 0 ? await ddp.tryCall("command:scene:begin-preview", { drawdyElementIds: legs.map((m) => m.id) }) : null;
    const live = new Set(began?.began ?? []);
    const animated = legs.filter((m) => live.has(m.id));
    // Ending without commits drops the preview, recording nothing.
    const end = () => (animated.length > 0 ? ddp.tryCall("command:scene:end-preview", { commits: [] }) : null);

    try {
        const total = durationMs + Math.max(0, ...animated.map((m) => m.delayMs));
        const started = Date.now();
        // Each call resolves on Drawdy's next frame, which paces the loop.
        // The last frame is always the end state, so landing moves nothing.
        for (let elapsed = 0; animated.length > 0; elapsed = Math.min(Date.now() - started, total)) {
            await ddp.call("command:scene:preview-transforms", {
                previews: offsetsAt(animated, elapsed, durationMs).map(({ id, x, y }) => ({
                    drawdyElementId: id,
                    transform: { x, y, scale: 1, rotation: 0 },
                })),
            });
            if (elapsed >= total) break;
        }
    } catch (err) {
        await end();
        throw err;
    }
    await Promise.all([end(), land()]);
};
