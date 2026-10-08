import * as g from "../lib/guard.ts";
import { MODEL } from "../shared/protocol.ts";
import type { Ddp } from "./ddp.ts";
import type { ModelFileStore } from "./engine-client.ts";

const PREFIX = "model-file:";

const storedFile = g.object({ blob: g.instanceOf(Blob), size: g.number, savedAt: g.number });

/**
 * Model files in Drawdy's kv-storage: IndexedDB on Drawdy's origin, so they
 * survive reloads, which nothing inside the sandbox can do. Payloads travel
 * by structured clone, so a Blob goes in and comes back as a Blob.
 *
 * If the user denies `storage`, every read misses and the model downloads
 * again next session; nothing else changes.
 */
export type SetupFlag = {
    /** Whether this device has downloaded the current model before. */
    isDone: () => Promise<boolean>;
    markDone: () => Promise<void>;
};

const SETUP_KEY = "setup:model";
const setupRecord = g.object({ revision: g.string });

/**
 * Remembers on this device that the user agreed to the one-time download
 * and it finished, so later sessions load the model without asking. A new
 * model revision asks again: it is a new download.
 */
export const kvSetupFlag = (ddp: Ddp): SetupFlag => ({
    isDone: async () => {
        const value = await ddp.tryCall("command:kv-storage:get", { key: SETUP_KEY });
        return g.parse(setupRecord, value?.got)?.revision === MODEL.revision;
    },
    markDone: async () => {
        await ddp.tryCall("command:kv-storage:set", { key: SETUP_KEY, payload: { revision: MODEL.revision } });
    },
});

export const kvModelStore = (ddp: Ddp): ModelFileStore => ({
    get: async (key) => {
        const value = await ddp.tryCall("command:kv-storage:get", { key: PREFIX + key });
        return g.parse(storedFile, value?.got)?.blob ?? null;
    },
    put: async (key, blob) => {
        await ddp.call("command:kv-storage:set", {
            key: PREFIX + key,
            payload: { blob, size: blob.size, savedAt: Date.now() },
        });
    },
});
