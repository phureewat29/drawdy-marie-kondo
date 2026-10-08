import { describe, expect, it } from "@jest/globals";
import { center, concatenate, dot, mean, normalize, standouts, topK } from "./vectors.ts";

const v = (...xs: number[]) => Float32Array.from(xs);

describe("vector math", () => {
    it("normalizes to unit length without mutating the input", () => {
        const input = v(3, 4);
        const unit = normalize(input);
        expect(dot(unit, unit)).toBeCloseTo(1, 6);
        expect(Array.from(input)).toEqual([3, 4]);
        expect(Array.from(normalize(v(0, 0)))).toEqual([0, 0]);
    });

    it("averages vectors", () => {
        expect(Array.from(mean([v(1, 0), v(0, 1)]))).toEqual([0.5, 0.5]);
    });

    it("centering removes the shared component", () => {
        const [a, b] = center([v(1, 0.1), v(1, -0.1)]);
        expect(dot(a, b)).toBeLessThan(-0.99);
    });

    it("concatenates views into one unit vector per row", () => {
        const [joined] = concatenate([[normalize(v(3, 4))], [normalize(v(1, 0))]]);
        expect(joined).toHaveLength(4);
        expect(dot(joined, joined)).toBeCloseTo(1, 6);
    });

    it("ranks the top k scores", () => {
        expect(topK([0.1, 0.9, 0.5], 2)).toEqual([1, 2]);
    });
});

describe("standouts", () => {
    it("keeps only scores well above the rest and above the floor", () => {
        const scores = [0.74, 0.75, 0.76, 0.75, 0.93, 0.91, 0.74, 0.76];
        expect(standouts(scores, { floor: 0.8, zScore: 1, max: 10 })).toEqual([4, 5]);
    });

    it("returns nothing when no score clears the floor", () => {
        expect(standouts([0.5, 0.52], { floor: 0.8, zScore: 1, max: 10 })).toEqual([]);
        expect(standouts([], { floor: 0.8, zScore: 1, max: 10 })).toEqual([]);
    });
});
