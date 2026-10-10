import { describe, expect, it } from "@jest/globals";
import { isCatchAll, LEFTOVER, parseGroupNames, sortIntoNames } from "./named-groups.ts";
import { normalize, type Vec } from "./vectors.ts";

describe("parseGroupNames", () => {
    it("splits on commas, semicolons and lines, trimmed and without repeats", () => {
        expect(parseGroupNames(" Bugs, ideas;Praise\n\n bugs ,  Customer   love ")).toEqual(["Bugs", "ideas", "Praise", "Customer love"]);
    });

    it("finds nothing in blank input", () => {
        expect(parseGroupNames(" , ;\n ")).toEqual([]);
    });

    it("keeps names short enough for a frame label, and at most 20", () => {
        expect(parseGroupNames("x".repeat(80))[0]).toHaveLength(60);
        expect(parseGroupNames(Array.from({ length: 30 }, (_, i) => `G${i}`).join(","))).toHaveLength(20);
    });
});

describe("isCatchAll", () => {
    it.each(["Other", " misc ", "Unknown", "everything else"])("%s collects the leftovers", (name) => {
        expect(isCatchAll(name)).toBe(true);
    });

    it.each(["Security", "Other ideas", "Bugs"])("%s is a group of its own", (name) => {
        expect(isCatchAll(name)).toBe(false);
    });
});

/** A small board in three themes: views near an axis each, with a little spread. */
const board = () => {
    const near = (axis: number, wobble: number): Vec => normalize(Float32Array.from([0, 1, 2], (d) => (d === axis ? 1 : wobble * (d + 1))));
    const themes = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2];
    const views = themes.map((t, i) => near(t, 0.05 * (i % 3)));
    return { themes, views };
};

describe("sortIntoNames", () => {
    it("files each item under the name it matches", () => {
        const { themes, views } = board();
        // Names for themes 0 and 1; theme 2 matches both weakly.
        const scores = themes.map((t) => [t === 0 ? 0.8 : 0.6, t === 1 ? 0.8 : 0.6]);
        const sorted = sortIntoNames(scores, views, { leftovers: false });
        expect(sorted.slice(0, 10)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
        expect(sorted).not.toContain(LEFTOVER);
    });

    it("does not let a name that scores high against everything take everything", () => {
        const { themes, views } = board();
        // "Feedback" scores 0.75 on every note; "Speed" only on its own notes, a little lower.
        const scores = themes.map((t) => [0.75 + (t === 0 ? 0.05 : 0), t === 1 ? 0.74 : 0.6]);
        const sorted = sortIntoNames(scores, views, { leftovers: false });
        expect(sorted.slice(5, 10)).toEqual([1, 1, 1, 1, 1]);
    });

    it("recovers an item its name misses, from the items around it", () => {
        const { themes, views } = board();
        const scores = themes.map((t) => [t === 0 ? 0.8 : 0.6, t === 1 ? 0.8 : 0.6]);
        // A theme-1 note worded so it matches name 0 a little better.
        scores[7] = [0.62, 0.6];
        expect(sortIntoNames(scores, views, { leftovers: false })[7]).toBe(1);
    });

    it("leaves out what fits none of the names, when leftovers are expected", () => {
        const { themes, views } = board();
        const scores = themes.map((t) => [t === 0 ? 0.8 : 0.6]);
        const sorted = sortIntoNames(scores, views, { leftovers: true });
        expect(sorted).toEqual(themes.map((t) => (t === 0 ? 0 : LEFTOVER)));
    });

    it("sorts nothing when there is nothing to sort", () => {
        expect(sortIntoNames([], [], { leftovers: true })).toEqual([]);
    });
});
