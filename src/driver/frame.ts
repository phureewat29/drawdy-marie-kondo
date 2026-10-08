import type { DrawdyElementSchema } from "@drawdy/driver-protocol";
import { MARK, type GroupFrame } from "./board.ts";

type FrameSchema = Extract<DrawdyElementSchema, { type: "frame" }>;

/**
 * A frame carrying its name. Drawdy frames have names (the "Frame 1" label,
 * which users can rename), but `add-drawdy-elements` does not yet pass a name
 * to the host's `createFrame`, so today the frame shows its default name.
 * Sending `name` is harmless now and names the frame once the host forwards
 * it. Drop the cast when `@drawdy/driver-protocol` types `name` on frames.
 */
const namedFrame = (frame: Omit<FrameSchema, "type"> & { name: string }): DrawdyElementSchema =>
    ({ ...frame, type: "frame" }) as FrameSchema;

/** A group's frame, named after the group and marked as Sensemaker's. */
export const groupFrame = ({ id, rect, label }: GroupFrame): DrawdyElementSchema =>
    namedFrame({
        drawdyElementId: id,
        name: label,
        position: [rect.x, rect.y],
        width: rect.width,
        height: rect.height,
        rotation: 0,
        meta: { [MARK]: "frame", label },
    });
