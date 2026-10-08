/**
 * Embedding vector math. Inputs are never mutated; loops stay imperative
 * inside for speed, since this runs over hundreds of 768-d vectors.
 *
 * Embeddings are L2-normalized, so a dot product is a cosine similarity.
 */

export type Vec = Float32Array;

export const dot = (a: Vec, b: Vec): number => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
};

export const normalize = (v: Vec): Vec => {
    const n = Math.sqrt(dot(v, v));
    return n === 0 ? new Float32Array(v.length) : v.map((x) => x / n);
};

export const mean = (vs: readonly Vec[]): Vec => {
    const out = new Float32Array(vs[0]?.length ?? 0);
    for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i] / vs.length;
    return out;
};

/**
 * Subtracts `origin` (by default the mean of `vs`) and renormalizes.
 * Embeddings of short notes share a large common component (unrelated notes
 * still score ~0.75); removing it spreads them out so groups separate.
 */
export const center = (vs: readonly Vec[], origin: Vec = mean(vs)): Vec[] =>
    vs.map((v) => normalize(v.map((x, i) => x - origin[i])));

/** Joins several views of the same items into one normalized vector each. */
export const concatenate = (views: readonly (readonly Vec[])[]): Vec[] =>
    (views[0] ?? []).map((_, row) => {
        const parts = views.map((view) => view[row]);
        const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
        parts.reduce((offset, p) => (out.set(p, offset), offset + p.length), 0);
        return normalize(out);
    });

/** Indexes of the `k` highest scores, best first. */
export const topK = (scores: readonly number[], k: number): number[] =>
    scores
        .map((score, i) => ({ score, i }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(({ i }) => i);

/**
 * Picks the items that stand out as similar to a query: well above the
 * board's typical score, and above an absolute floor. Best first.
 */
export const standouts = (
    scores: readonly number[],
    options: { floor: number; zScore: number; max: number }
): number[] => {
    if (scores.length === 0) return [];
    const mu = scores.reduce((a, b) => a + b, 0) / scores.length;
    const sigma = Math.sqrt(
        scores.reduce((a, s) => a + (s - mu) * (s - mu), 0) / scores.length
    );
    const cut = Math.max(options.floor, mu + options.zScore * sigma);
    return topK(scores, options.max).filter((i) => scores[i] >= cut);
};
