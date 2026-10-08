import { describe, expect, it } from "@jest/globals";
import * as g from "./guard.ts";

const message = g.union(
    g.object({ type: g.literal("search"), query: g.string }),
    g.object({ type: g.literal("cluster"), k: g.optional(g.number) })
);

describe("guards", () => {
    it("accepts values of the described shape", () => {
        expect(message({ type: "search", query: "fees" })).toBe(true);
        expect(message({ type: "cluster" })).toBe(true);
        expect(message({ type: "cluster", k: 4 })).toBe(true);
    });

    it("rejects wrong field types, missing fields and non-objects", () => {
        expect(message({ type: "cluster", k: "4" })).toBe(false);
        expect(message({ type: "search" })).toBe(false);
        expect(message({ type: "unknown" })).toBe(false);
        expect(message(null)).toBe(false);
        expect(message("search")).toBe(false);
    });

    it("rejects non-finite numbers", () => {
        expect(g.parse(g.arrayOf(g.number), [1, Number.NaN])).toBeNull();
        expect(g.parse(g.arrayOf(g.number), [1, 2])).toEqual([1, 2]);
        expect(g.parse(g.number, Number.NaN)).toBeNull();
        expect(g.parse(g.number, Number.POSITIVE_INFINITY)).toBeNull();
        expect(g.parse(g.number, 2)).toBe(2);
    });

    it("checks instances, nullables and enums", () => {
        expect(g.instanceOf(Float32Array)(new Float32Array(2))).toBe(true);
        expect(g.instanceOf(Float32Array)([0, 0])).toBe(false);
        expect(g.nullable(g.string)(null)).toBe(true);
        expect(g.oneOf(["a", "b"] as const)("b")).toBe(true);
        expect(g.oneOf(["a", "b"] as const)("c")).toBe(false);
    });
});
