import { describe, expect, it } from "@jest/globals";
import {
    clusterVectors,
    distances,
    kmeans,
    leadingEigenvectors,
    nearestGroups,
    silhouette,
    symmetricEigen,
} from "./cluster.ts";
import { range } from "./fp.ts";
import { rng } from "./random.ts";
import { dot, normalize, type Vec } from "./vectors.ts";

/** `perBlob` noisy unit vectors around each of `centers` orthogonal axes. */
const blobs = (centers: number, perBlob: number, { dim = 16, noise = 0.25, seed = 1 } = {}): Vec[] => {
    const random = rng(seed);
    return range(centers).flatMap((c) =>
        range(perBlob).map(() =>
            normalize(Float32Array.from(range(dim), (d) => (d === c ? 1 : 0) + (random() - 0.5) * noise))
        )
    );
};

/** Each blob maps to exactly one cluster, and no two blobs share one. */
const recoversBlobs = (assignments: readonly number[], centers: number, perBlob: number): boolean =>
    range(centers).every((c) => new Set(assignments.slice(c * perBlob, (c + 1) * perBlob)).size === 1) &&
    new Set(assignments).size === centers;

describe("kmeans", () => {
    it("separates well-spread blobs", () => {
        const vs = blobs(3, 8);
        const best = range(5)
            .map((seed) => kmeans(vs, 3, rng(seed)))
            .reduce((a, b) => (b.inertia < a.inertia ? b : a));
        expect(recoversBlobs(best.assignments, 3, 8)).toBe(true);
    });
});

describe("symmetricEigen", () => {
    it("recovers the eigenpairs of a known matrix", () => {
        const { values, vectors } = symmetricEigen([
            [2, 1],
            [1, 2],
        ]);
        expect(values.toSorted((a, b) => a - b)).toEqual([expect.closeTo(1, 9), expect.closeTo(3, 9)]);
        const top = values.indexOf(Math.max(...values));
        expect(Math.abs(vectors[0][top])).toBeCloseTo(Math.SQRT1_2, 9);
    });
});

describe("distances", () => {
    it("is 1 - cosine for every pair, symmetric, with a zero diagonal", () => {
        const vs = blobs(3, 5, { noise: 0.8 });
        const d = distances(vs);
        range(15).forEach((i) =>
            range(15).forEach((j) => {
                expect(d[i][j]).toBeCloseTo(i === j ? 0 : Math.max(0, 1 - dot(vs[i], vs[j])), 6);
                expect(d[i][j]).toBe(d[j][i]);
            })
        );
    });
});

describe("leadingEigenvectors", () => {
    it("matches a full decomposition beyond the Krylov space's size", () => {
        // A planted spectrum: three strong directions on top of noise.
        const n = 130;
        const random = rng(9);
        const planted = range(3).map(() => normalize(Float32Array.from(range(n), () => random() - 0.5)));
        const matrix = range(n).map((i) => {
            const row = new Float64Array(n);
            range(n).forEach((j) => {
                const signal = planted.reduce((s, u, c) => s + (3 - c) * u[i] * u[j], 0);
                row[j] = signal + (i === j ? 0.2 : 0) + 0.01 * Math.sin(i * j);
            });
            return row;
        });
        // Symmetrize the noise term exactly.
        range(n).forEach((i) => range(i).forEach((j) => (matrix[i][j] = matrix[j][i])));
        const { values, vectors } = symmetricEigen(matrix);
        const order = range(n).toSorted((a, b) => values[b] - values[a]);
        const found = leadingEigenvectors(matrix, 3, rng(1));
        found.forEach((v, c) => {
            const exact = Float64Array.from(range(n), (i) => vectors[i][order[c]]);
            const cosine = v.reduce((s, x, i) => s + x * exact[i], 0);
            expect(Math.abs(cosine)).toBeCloseTo(1, 6);
        });
    });
});

describe("silhouette", () => {
    it("scores the true grouping well above a shuffled one", () => {
        const d = distances(blobs(3, 6));
        const truth = range(18).map((i) => Math.floor(i / 6));
        const shuffled = range(18).map((i) => i % 3);
        expect(silhouette(d, truth, 3)).toBeGreaterThan(0.5);
        expect(silhouette(d, shuffled, 3)).toBeLessThan(0);
    });
});

describe("clusterVectors", () => {
    it("finds the number of groups on its own", () => {
        const result = clusterVectors(blobs(4, 6));
        expect(result.k).toBe(4);
        expect(recoversBlobs(result.assignments, 4, 6)).toBe(true);
    });

    it("honours a fixed k and numbers clusters largest first", () => {
        const vs = [...blobs(1, 9, { seed: 3 }), ...blobs(2, 3, { seed: 4 }).slice(3)];
        const result = clusterVectors(vs, { k: 2 });
        expect(result.k).toBe(2);
        const sizes = range(2).map((c) => result.assignments.filter((a) => a === c).length);
        expect(sizes[0]).toBeGreaterThanOrEqual(sizes[1]);
    });

    it("is deterministic for a seed", () => {
        const vs = blobs(3, 7, { noise: 0.6 });
        expect(clusterVectors(vs, { seed: 5 })).toEqual(clusterVectors(vs, { seed: 5 }));
    });

    it("separates many groups in a selection larger than the Krylov space", () => {
        const result = clusterVectors(blobs(6, 25, { dim: 24, noise: 0.5 }));
        expect(result.k).toBe(6);
        expect(recoversBlobs(result.assignments, 6, 25)).toBe(true);
    });

    it("keeps tiny inputs in one group", () => {
        expect(clusterVectors(blobs(1, 3)).assignments).toEqual([0, 0, 0]);
        expect(clusterVectors([]).k).toBe(0);
    });
});

describe("nearestGroups", () => {
    it("files each item under the group with its closest members", () => {
        const axis = (i: number) => normalize(Float32Array.from(range(4), (d) => (d === i ? 1 : 0.05)));
        const groups = [[axis(0), axis(0)], [axis(1)], [axis(2), axis(2)]];
        expect(nearestGroups([axis(2), axis(0), axis(1)], groups)).toEqual([2, 0, 1]);
    });

    it("never picks an empty group", () => {
        const v = normalize(Float32Array.from([1, 0]));
        expect(nearestGroups([v], [[], [v]])).toEqual([1]);
    });
});
