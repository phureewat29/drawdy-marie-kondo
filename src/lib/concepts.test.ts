import { describe, expect, it } from "@jest/globals";
import { bestGroup, CLEAR_HIT, claimNotes, CONCEPTS, describeGroups, nameGroups } from "./concepts.ts";
import { normalize, type Vec } from "./vectors.ts";

const axis = (i: number, noise = 0): Vec => normalize(Float32Array.from({ length: 4 }, (_, d) => (d === i ? 1 : noise)));

describe("describeGroups", () => {
    it("ranks the concepts a group matches more than the other groups do", () => {
        // Concepts 0..3 point along axes; group 0 shows axis 1, group 1 axis 2.
        const concepts = [0, 1, 2, 3].map((i) => axis(i));
        const described = describeGroups([[axis(1, 0.1), axis(1, 0.2)], [axis(2, 0.1)]], concepts, 2);
        expect(described[0][0]).toBe(1);
        expect(described[1][0]).toBe(2);
    });
});

describe("nameGroups", () => {
    it("gives every group its own name", () => {
        expect(nameGroups([[5, 1], [5, 2], [5, 1, 3]])).toEqual([5, 2, 1]);
    });
});

describe("bestGroup", () => {
    const concepts = [axis(0), axis(1)];
    const near = (x: number) => normalize(Float32Array.from([x, 1 - x, 0, 0]));

    it("joins the group with the best two hits, not one stray note", () => {
        // Group 0 has one very close note; group 1 has two close ones.
        const notes = [near(0.99), axis(3), near(0.93), near(0.92)];
        expect(bestGroup([0], concepts, notes, [0, 0, 1, 1])).toBe(1);
    });

    it("keeps a group apart without a clear hit", () => {
        const weak = normalize(Float32Array.from([0.6, 0, 0.8, 0]));
        expect(weak[0]).toBeLessThan(CLEAR_HIT);
        expect(bestGroup([0, 1], concepts, [weak], [0])).toBe(-1);
        expect(bestGroup([0], concepts, [], [])).toBe(-1);
    });
});

describe("claimNotes", () => {
    it("gives each note to the group of images that clearly finds it", () => {
        const concepts = [axis(0), axis(1)];
        const notes = [axis(1, 0.05), axis(3), axis(0, 0.05)];
        expect(claimNotes([[0], [1]], concepts, notes)).toEqual([1, -1, 0]);
    });
});

describe("CONCEPTS", () => {
    it("has no duplicates", () => {
        expect(new Set(CONCEPTS.map((c) => c.toLowerCase())).size).toBe(CONCEPTS.length);
    });
});
