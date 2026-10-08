/**
 * Clustering for sticky-note embeddings: self-tuning spectral clustering,
 * spherical k-means, and silhouette-based choice of the number of groups.
 * Functions are pure; the numeric loops inside are imperative for speed.
 */

import { range } from "./fp.ts";
import { rng } from "./random.ts";
import { dot, mean, normalize, type Vec } from "./vectors.ts";

export type Clustering = {
    k: number;
    /** Cluster per input vector; cluster 0 is the largest. */
    assignments: number[];
    silhouette: number;
};

/** A square matrix, by rows. */
type Matrix = readonly ArrayLike<number>[];

/**
 * Pairwise cosine distances, each pair computed once. Four rows share each
 * vector read from memory, which makes this ~2.5× faster than pair by pair:
 * it is the O(n²·d) step that dominates for large selections.
 */
export const distances = (vs: readonly Vec[]): Float64Array[] => {
    const n = vs.length;
    const dim = n > 0 ? vs[0].length : 0;
    const rows = range(n).map(() => new Float64Array(n));
    const store = (r: number, j: number, similarity: number) => {
        if (r < j) rows[r][j] = rows[j][r] = Math.max(0, 1 - similarity);
    };
    for (let i = 0; i < n; i += 4) {
        const a0 = vs[i];
        const a1 = vs[Math.min(i + 1, n - 1)];
        const a2 = vs[Math.min(i + 2, n - 1)];
        const a3 = vs[Math.min(i + 3, n - 1)];
        for (let j = i + 1; j < n; j++) {
            const b = vs[j];
            let s0 = 0;
            let s1 = 0;
            let s2 = 0;
            let s3 = 0;
            for (let t = 0; t < dim; t++) {
                const x = b[t];
                s0 += a0[t] * x;
                s1 += a1[t] * x;
                s2 += a2[t] * x;
                s3 += a3[t] * x;
            }
            store(i, j, s0);
            store(i + 1, j, s1);
            store(i + 2, j, s2);
            store(i + 3, j, s3);
        }
    }
    return rows;
};

const dot64 = (a: Float64Array, b: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
};

const multiply = (matrix: Matrix, v: Float64Array): Float64Array => {
    const out = new Float64Array(matrix.length);
    for (let i = 0; i < matrix.length; i++) {
        const row = matrix[i];
        let s = 0;
        for (let j = 0; j < v.length; j++) s += row[j] * v[j];
        out[i] = s;
    }
    return out;
};

const argmax = (xs: readonly number[]): number =>
    xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0);

type KMeansRun = { assignments: number[]; inertia: number };

/** Spherical k-means with k-means++ seeding. */
export const kmeans = (vs: readonly Vec[], k: number, random: () => number): KMeansRun => {
    const n = vs.length;
    const seeds: Vec[] = [vs[Math.floor(random() * n)]];
    const nearest = new Float64Array(n).fill(Infinity);
    while (seeds.length < Math.min(k, n)) {
        const last = seeds[seeds.length - 1];
        for (let i = 0; i < n; i++) nearest[i] = Math.min(nearest[i], 1 - dot(vs[i], last));
        // Draw the next seed with probability proportional to distance².
        const weights = Array.from(nearest, (d) => d * d);
        const target = random() * weights.reduce((s, w) => s + w, 0);
        let acc = 0;
        const pick = weights.findIndex((w) => (acc += w) >= target);
        seeds.push(vs[pick === -1 ? n - 1 : pick]);
    }

    let centroids = seeds;
    let assignments: number[] = [];
    for (let iteration = 0; iteration < 60; iteration++) {
        const next = vs.map((v) => argmax(centroids.map((c) => dot(v, c))));
        const stable = next.every((c, i) => c === assignments[i]);
        assignments = next;
        if (stable) break;
        centroids = centroids.map((old, c) => {
            const members = vs.filter((_, i) => assignments[i] === c);
            return members.length > 0 ? normalize(mean(members)) : old;
        });
    }
    const inertia = vs.reduce((s, v, i) => s + 1 - dot(v, centroids[assignments[i]]), 0);
    return { assignments, inertia };
};

/**
 * Mean silhouette over a distance matrix: near 1 for tight, well separated
 * clusters, near 0 for overlapping ones. Singletons count as 0.
 */
export const silhouette = (distance: Matrix, assignments: readonly number[], k: number): number => {
    const n = distance.length;
    if (k < 2 || n <= k) return 0;
    const sums = new Float64Array(k);
    const counts = new Float64Array(k);
    let total = 0;
    for (let i = 0; i < n; i++) {
        sums.fill(0);
        counts.fill(0);
        const row = distance[i];
        for (let j = 0; j < n; j++) {
            if (j === i) continue;
            sums[assignments[j]] += row[j];
            counts[assignments[j]]++;
        }
        const own = assignments[i];
        if (counts[own] === 0) continue;
        const a = sums[own] / counts[own];
        let b = Infinity;
        for (let c = 0; c < k; c++) if (c !== own && counts[c] > 0) b = Math.min(b, sums[c] / counts[c]);
        // Identical notes split across groups would score 0 / 0.
        if (b !== Infinity && Math.max(a, b) > 0) total += (b - a) / Math.max(a, b);
    }
    return total / n;
};

/**
 * Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations.
 * O(n³) per sweep: for small matrices, like the projected problem in
 * `leadingEigenvectors`.
 */
export const symmetricEigen = (matrix: Matrix): { values: number[]; vectors: number[][] } => {
    const n = matrix.length;
    const a = matrix.map((row) => Array.from(row));
    const v = range(n).map((i) => range(n).map((j) => (i === j ? 1 : 0)));
    const rotateColumns = (m: number[][], c: number, s: number, p: number, q: number) => {
        for (let k = 0; k < n; k++) {
            const x = m[k][p];
            const y = m[k][q];
            m[k][p] = c * x - s * y;
            m[k][q] = s * x + c * y;
        }
    };
    const rotateRows = (m: number[][], c: number, s: number, p: number, q: number) => {
        const rp = m[p];
        const rq = m[q];
        for (let k = 0; k < n; k++) {
            const x = rp[k];
            const y = rq[k];
            rp[k] = c * x - s * y;
            rq[k] = s * x + c * y;
        }
    };
    for (let sweep = 0; sweep < 50; sweep++) {
        let off = 0;
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
        if (off < 1e-14) break;
        for (let p = 0; p < n; p++) {
            for (let q = p + 1; q < n; q++) {
                if (Math.abs(a[p][q]) < 1e-15) continue;
                const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
                const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                const c = 1 / Math.sqrt(t * t + 1);
                const s = t * c;
                rotateColumns(a, c, s, p, q);
                rotateRows(a, c, s, p, q);
                rotateColumns(v, c, s, p, q);
            }
        }
    }
    return { values: a.map((row, i) => row[i]), vectors: v };
};

/** Krylov space size for `leadingEigenvectors`: ample for up to 8 groups. */
const KRYLOV_SIZE = 96;

/**
 * The `count` leading eigenvectors of a symmetric matrix, largest eigenvalue
 * first, by Rayleigh-Ritz on a randomized block Krylov space (Musco & Musco,
 * 2015). Each basis vector costs one matrix-vector product, O(n²), where a
 * Jacobi sweep of the whole matrix costs O(n³). Blocks wider than `count`
 * keep apart the near-equal eigenvalues of well separated groups, which a
 * single Krylov vector would merge.
 */
export const leadingEigenvectors = (matrix: Matrix, count: number, random: () => number): Float64Array[] => {
    const n = matrix.length;
    const size = Math.min(n, Math.max(KRYLOV_SIZE, 3 * count));
    const width = Math.min(n, count + 4);
    const basis: Float64Array[] = [];
    const images: Float64Array[] = [];
    // Adds what is left of `v` (twice orthogonalized against the basis) as
    // a basis vector, unless nothing is.
    const extend = (v: Float64Array) => {
        for (let pass = 0; pass < 2; pass++) {
            for (const b of basis) {
                const c = dot64(b, v);
                for (let i = 0; i < n; i++) v[i] -= c * b[i];
            }
        }
        const norm = Math.sqrt(dot64(v, v));
        if (norm < 1e-9) return;
        for (let i = 0; i < n; i++) v[i] /= norm;
        basis.push(v);
        images.push(multiply(matrix, v));
    };
    const noise = () => Float64Array.from({ length: n }, () => random() - 0.5);
    let block = range(width).map(noise);
    while (basis.length < size) {
        const before = basis.length;
        for (const v of block) if (basis.length < size) extend(v);
        // Grow by the matrix times the newest vectors; restart from noise if
        // the space stopped growing (it found an invariant subspace).
        block = basis.length > before ? images.slice(before).map((v) => v.slice()) : range(width).map(noise);
    }

    const m = basis.length;
    const projected = range(m).map(() => new Float64Array(m));
    for (let i = 0; i < m; i++) {
        for (let j = 0; j <= i; j++) projected[i][j] = projected[j][i] = dot64(basis[i], images[j]);
    }
    const { values, vectors } = symmetricEigen(projected);
    return range(m)
        .toSorted((x, y) => values[y] - values[x])
        .slice(0, count)
        .map((col) => {
            const out = new Float64Array(n);
            for (let r = 0; r < m; r++) {
                const weight = vectors[r][col];
                const b = basis[r];
                for (let i = 0; i < n; i++) out[i] += weight * b[i];
            }
            return out;
        });
};

/**
 * Spectral embedding with self-tuning affinities (Zelnik-Manor & Perona):
 * each point's scale is its distance to its `knn`-th neighbour, so dense and
 * sparse parts of a board are treated alike. Returns, for any k up to
 * `count`, the normalized rows of the top-k eigenvectors (Ng, Jordan & Weiss).
 */
const spectralEmbedding = (distance: readonly Float64Array[], knn: number, count: number, random: () => number) => {
    const n = distance.length;
    const rank = Math.min(knn, n - 1);
    const scale = distance.map((row) => Math.max(row.slice().sort()[rank], 1e-6));
    const affinity = range(n).map(() => new Float64Array(n));
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const d = distance[i][j];
            affinity[i][j] = affinity[j][i] = Math.exp(-(d * d) / (scale[i] * scale[j]));
        }
    }
    // Normalized in place: D^-1/2 · A · D^-1/2.
    const inverseRoot = affinity.map((row) => 1 / Math.sqrt(row.reduce((s, x) => s + x, 0) || 1e-12));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) affinity[i][j] *= inverseRoot[i] * inverseRoot[j];
    }
    const vectors = leadingEigenvectors(affinity, count, random);
    return (k: number): Vec[] => range(n).map((i) => normalize(Float32Array.from(range(k), (c) => vectors[c][i])));
};

/** Renumbers clusters so cluster 0 is the largest, dropping empty ones. */
const largestFirst = (raw: readonly number[], score: number): Clustering => {
    const sizes = raw.reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map<number, number>());
    const order = [...sizes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).map(([c]) => c);
    const rank = new Map(order.map((c, i) => [c, i]));
    return { k: order.length, assignments: raw.map((c) => rank.get(c)!), silhouette: score };
};

export type ClusterOptions = {
    /** Fixed number of groups; chosen by silhouette when omitted. */
    k?: number;
    seed?: number;
    knn?: number;
    /** The smallest groups worth making on average: caps k at n / this. */
    minGroupSize?: number;
};

/**
 * Groups embeddings with spectral clustering. Without a fixed `k`, tries
 * 3..8 groups (2.. for small selections) and keeps the best silhouette.
 * Two-way splits are skipped from 12 notes up: they are rarely what an
 * affinity map wants, and silhouette over-rewards them on short texts.
 */
export const clusterVectors = (vs: readonly Vec[], options: ClusterOptions = {}): Clustering => {
    const n = vs.length;
    if (n < 4) return { k: n ? 1 : 0, assignments: vs.map(() => 0), silhouette: 0 };

    const seed = options.seed ?? 7;
    const fixed = options.k === undefined ? null : Math.max(1, Math.min(options.k, n));
    const minK = n >= 12 ? 3 : 2;
    const maxK = Math.max(minK, Math.min(8, Math.floor(n / (options.minGroupSize ?? 3))));
    const distance = distances(vs);
    const embed = spectralEmbedding(distance, options.knn ?? 6, fixed ?? maxK, rng(seed + 1));
    const random = rng(seed);
    const run = (k: number): Clustering => {
        const rows = embed(k);
        const best = range(12)
            .map(() => kmeans(rows, k, random))
            .reduce((x, y) => (y.inertia < x.inertia ? y : x));
        return largestFirst(best.assignments, silhouette(distance, best.assignments, k));
    };

    if (fixed !== null) return run(fixed);
    return range(maxK - minK + 1)
        .map((i) => run(minK + i))
        .reduce((best, c) => (c.silhouette > best.silhouette ? c : best));
};

/**
 * For each of `items`, the group it fits best: the group whose closest
 * `top` members score highest on average. Used to file images under the
 * notes that describe them, since images and text embeddings sit apart
 * (the "modality gap") and would otherwise only ever group with each other.
 */
export const nearestGroups = (items: readonly Vec[], groups: readonly (readonly Vec[])[], top = 2): number[] =>
    items.map((item) =>
        argmax(
            groups.map((members) => {
                const best = members.map((m) => dot(item, m)).toSorted((a, b) => b - a).slice(0, top);
                return best.length > 0 ? best.reduce((s, x) => s + x, 0) / best.length : -Infinity;
            })
        )
    );
