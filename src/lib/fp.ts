/**
 * The handful of collection helpers Janitor needs, es-toolkit style.
 *
 * Drawdy's marketplace build only lets an extension import
 * `@drawdy/driver-protocol`, so these live here instead of coming from npm.
 */

export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export const clamp = (x: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, x));

/** Splits `xs` into consecutive slices of the given lengths. */
export const splitBy = <T>(xs: readonly T[], lengths: readonly number[]): T[][] =>
    lengths.map((n, i) => {
        const start = sum(lengths.slice(0, i));
        return xs.slice(start, start + n);
    });

/** Keeps the first item for each key, in order. */
export const uniqBy = <T>(xs: readonly T[], key: (x: T) => string): T[] => {
    const seen = new Set<string>();
    return xs.filter((x) => !seen.has(key(x)) && Boolean(seen.add(key(x))));
};

export const maxBy = <T>(xs: readonly T[], score: (x: T) => number): T | undefined =>
    xs.reduce<T | undefined>(
        (best, x) => (best === undefined || score(x) > score(best) ? x : best),
        undefined
    );

export const isDefined = <T>(x: T | null | undefined): x is T => x != null;

export const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/** Calls `fn` once calls stop for `ms`, with the last call's arguments. */
export const debounce = <A extends unknown[]>(fn: (...args: A) => void, ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return (...args: A): void => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
};

/**
 * Runs async jobs one at a time, in order. A failing job does not stop the
 * ones queued after it.
 */
export const serial = () => {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(job: () => Promise<T>): Promise<T> => {
        const run = tail.then(job, job);
        tail = run.catch(() => undefined);
        return run;
    };
};

/** A stable 32-bit hash, for seeding from content. */
export const hash = (text: string): number =>
    [...text].reduce((h, ch) => Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0, 2166136261);

/** Splits `xs` into the items that pass `test` and the ones that don't. */
export const partition = <T>(xs: readonly T[], test: (x: T) => boolean): [T[], T[]] => [
    xs.filter(test),
    xs.filter((x) => !test(x)),
];

export const truncate = (text: string, max: number): string =>
    [...text].length <= max ? text : `${[...text].slice(0, max - 1).join("")}…`;
