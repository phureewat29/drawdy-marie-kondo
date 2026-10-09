import type { DriverCommand, DriverCommandIssuer, ProtocolCommandError } from "@drawdy/driver-protocol";

type CommandType = DriverCommand["type"];
type CommandOf<T extends CommandType> = Extract<DriverCommand, { type: T }>;
type RequestOf<T extends CommandType> = CommandOf<T> extends { req: infer R } ? R : undefined;
type Args<T extends CommandType> = RequestOf<T> extends undefined ? [] : [req: RequestOf<T>];
export type ValueOf<T extends CommandType> = Extract<CommandOf<T>["res"], { error?: never }>["value"];

/** A typed, promise-returning view of Drawdy's command channel. */
export type Ddp = {
    readonly driverId: string;
    /** Issues a command and resolves with its value; a protocol error rejects. */
    call: <T extends CommandType>(type: T, ...args: Args<T>) => Promise<ValueOf<T>>;
    /** Like `call`, but failures resolve to `null`. */
    tryCall: <T extends CommandType>(type: T, ...args: Args<T>) => Promise<ValueOf<T> | null>;
};

export const createDdp = (issue: DriverCommandIssuer, driverId: string): Ddp => {
    let sequence = 0;
    const call = async <T extends CommandType>(type: T, ...args: Args<T>): Promise<ValueOf<T>> => {
        const request = { type, driverId, requestId: String(sequence++), ...(args.length > 0 ? { req: args[0] } : {}) };
        const { res } = await issue(request as Parameters<DriverCommandIssuer>[0]);
        if (res.error) {
            throw new Error(`${type}: ${res.error.message ?? res.error.type}`, { cause: res.error });
        }
        return res.value as ValueOf<T>;
    };
    const tryCall = <T extends CommandType>(type: T, ...args: Args<T>): Promise<ValueOf<T> | null> =>
        call(type, ...args).catch(() => null);
    return { driverId, call, tryCall };
};

/** The protocol error behind a rejected `call`, if that is what it was. */
export const protocolError = (err: unknown): ProtocolCommandError | null =>
    err instanceof Error && typeof err.cause === "object" && err.cause !== null && "type" in err.cause
        ? (err.cause as ProtocolCommandError)
        : null;

/** A failure, in words for the panel. */
export const explain = (err: unknown): string =>
    protocolError(err)?.type === "unauthorized"
        ? "Janitor doesn't have permission for this. Turn it on in Extensions › Janitor › Manage permissions."
        : `Something went wrong: ${err instanceof Error ? err.message : String(err)}`;
