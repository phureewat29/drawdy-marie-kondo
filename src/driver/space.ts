import { isDefined } from "../lib/fp.ts";
import { inflate, union, type Rect } from "../lib/layout.ts";
import type { Ddp } from "./ddp.ts";

/** Clearance kept around and beside placed content, in canvas units. */
const MARGIN = 200;

/**
 * Where a block shaped like `wanted` can go without covering anything except
 * the elements in `ignore` (typically the ones about to move into it): at
 * `wanted` itself when that is clear, otherwise just right of everything on
 * the board, top-aligned with `wanted`.
 */
export const findFreeSpot = async (
    ddp: Ddp,
    wanted: Rect,
    ignore: ReadonlySet<string> = new Set()
): Promise<{ x: number; y: number }> => {
    const { drawdyElements: inside } = await ddp.call("command:scene:query-rect", {
        rect: inflate(wanted, MARGIN / 4),
        properties: ["type"],
    });
    if (inside.every((e) => ignore.has(e.id))) return { x: wanted.x, y: wanted.y };

    const { drawdyElements: all } = await ddp.call("command:scene:get-drawdy-elements", {
        properties: ["x", "y", "width", "height"],
    });
    const others = all
        .filter((e) => !ignore.has(e.id))
        .map(({ x, y, width, height }) =>
            x === undefined || y === undefined ? null : { x, y, width: width ?? 0, height: height ?? 0 }
        )
        .filter(isDefined);
    if (others.length === 0) return { x: wanted.x, y: wanted.y };
    const board = union(others);
    return { x: board.x + board.width + MARGIN, y: wanted.y };
};
