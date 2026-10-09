import type { ModuleStyling } from "@drawdy/driver-protocol";
import type { DriverToWebview, Tone } from "../shared/protocol.ts";
import type { BoardCache } from "./board.ts";
import type { Channel } from "./channel.ts";
import type { Ddp } from "./ddp.ts";
import type { Embeddings } from "./embeddings.ts";
import type { EngineClient } from "./engine-client.ts";
import type { Highlighter } from "./highlight.ts";

/** Everything an action needs, passed in explicitly. */
export type Context = {
    ddp: Ddp;
    generateId: () => string;
    styling: () => ModuleStyling;
    channel: Channel;
    board: BoardCache;
    engine: EngineClient;
    embeddings: Embeddings;
    highlight: Highlighter;
    /** Sends to the panel; queued until it is open. */
    tell: (message: DriverToWebview) => void;
    notify: (text: string, tone: Tone) => void;
    /** Shows what Marie Kondo is doing in the panel's status line, and how far along (0..1). */
    busy: (text: string | null, progress?: number) => void;
};

/** What the user can ask for, from the panel or the context menu. */
export type Action =
    | { type: "cluster"; k?: number }
    | { type: "similar" }
    | { type: "open-panel" }
    | { type: "demo" };
