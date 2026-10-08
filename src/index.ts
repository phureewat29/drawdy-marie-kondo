import type { DriverModule } from "@drawdy/driver-protocol";
import { createRuntime, type Runtime } from "./driver/runtime.ts";

let runtime: Runtime | null = null;

export const activate: DriverModule["activate"] = async (args) => {
    runtime = createRuntime(args);
    await runtime.start();
};

export const onEvent: DriverModule["onEvent"] = async (event) => {
    await runtime?.handle(event);
};
