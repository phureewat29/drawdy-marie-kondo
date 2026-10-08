/**
 * Runtime guards that double as types, zod style: build a guard, check
 * `unknown` input with it, and derive the static type with `Infer`.
 *
 * Drawdy's marketplace build only lets an extension import
 * `@drawdy/driver-protocol`, so this small subset lives here.
 */

export type Guard<T> = (value: unknown) => value is T;
export type Infer<G> = G extends Guard<infer T> ? T : never;

type Shape = Record<string, Guard<unknown>>;
type OptionalKeys<S extends Shape> = {
    [K in keyof S]: undefined extends Infer<S[K]> ? K : never;
}[keyof S];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
type FromShape<S extends Shape> = Simplify<
    { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
        [K in OptionalKeys<S>]?: Infer<S[K]>;
    }
>;

export const string: Guard<string> = (v): v is string => typeof v === "string";

export const number: Guard<number> = (v): v is number =>
    typeof v === "number" && Number.isFinite(v);

export const boolean: Guard<boolean> = (v): v is boolean => typeof v === "boolean";

export const literal =
    <const T extends string | number | boolean>(expected: T): Guard<T> =>
    (v): v is T =>
        v === expected;

export const oneOf =
    <const T extends readonly string[]>(values: T): Guard<T[number]> =>
    (v): v is T[number] =>
        typeof v === "string" && values.includes(v);

export const instanceOf =
    <T>(ctor: abstract new (...args: never[]) => T): Guard<T> =>
    (v): v is T =>
        v instanceof ctor;

export const nullable =
    <T>(guard: Guard<T>): Guard<T | null> =>
    (v): v is T | null =>
        v === null || guard(v);

export const optional =
    <T>(guard: Guard<T>): Guard<T | undefined> =>
    (v): v is T | undefined =>
        v === undefined || guard(v);

export const arrayOf =
    <T>(guard: Guard<T>): Guard<T[]> =>
    (v): v is T[] =>
        Array.isArray(v) && v.every(guard);

export const object =
    <S extends Shape>(shape: S): Guard<FromShape<S>> =>
    (v): v is FromShape<S> =>
        typeof v === "object" &&
        v !== null &&
        Object.entries(shape).every(([key, guard]) =>
            guard((v as Record<string, unknown>)[key])
        );

export const union =
    <const G extends readonly Guard<unknown>[]>(...guards: G): Guard<Infer<G[number]>> =>
    (v): v is Infer<G[number]> =>
        guards.some((guard) => guard(v));

/** `value` typed as `T` when it passes, otherwise `null`. */
export const parse = <T>(guard: Guard<T>, value: unknown): T | null =>
    guard(value) ? value : null;
