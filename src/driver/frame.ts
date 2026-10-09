import type { DrawdyElementSchema } from "@drawdy/driver-protocol";
import { MARK, type GroupFrame } from "./board.ts";

/**
 * A group's frame, marked as Marie Kondo's and named after the group: the name
 * shows above the frame on the board, where users can rename it.
 */
export const groupFrame = ({ id, rect, label }: GroupFrame): DrawdyElementSchema => ({
    type: "frame",
    drawdyElementId: id,
    name: label,
    position: [rect.x, rect.y],
    width: rect.width,
    height: rect.height,
    rotation: 0,
    meta: { [MARK]: "frame", label },
});
