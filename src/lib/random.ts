/** Deterministic PRNG (mulberry32): the same board clusters the same way. */
export const rng = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** A shuffled copy of `xs` (Fisher-Yates), driven by `random`. */
export const shuffle = <T>(xs: readonly T[], random: () => number): T[] =>
    xs.reduceRight<T[]>((out, _, i) => {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
        return out;
    }, [...xs]);
