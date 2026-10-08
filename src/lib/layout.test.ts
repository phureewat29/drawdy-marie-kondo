import { describe, expect, it } from "@jest/globals";
import { range } from "./fp.ts";
import { inflate, layoutGroups, moveLayout, union, type Rect } from "./layout.ts";

const NOTE = { width: 200, height: 193 };
const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const pairs = <T>(xs: readonly T[]): [T, T][] => xs.flatMap((a, i) => xs.slice(i + 1).map((b): [T, T] => [a, b]));

describe("layoutGroups", () => {
    const groups = [7, 5, 3, 3, 1].map((n, g) => range(n).map((i) => ({ id: `${g}-${i}`, ...NOTE })));
    const layout = layoutGroups(groups, { x: 100, y: -50 });
    const itemRects = layout.groups.map((group) => group.items.map((item) => ({ ...item, ...NOTE })));

    it("places every item inside its own frame", () => {
        layout.groups.forEach((group, g) => {
            expect(group.items).toHaveLength(groups[g].length);
            for (const rect of itemRects[g]) {
                expect(rect.x).toBeGreaterThanOrEqual(group.frame.x);
                expect(rect.x + rect.width).toBeLessThanOrEqual(group.frame.x + group.frame.width);
                expect(rect.y).toBeGreaterThanOrEqual(group.frame.y);
                expect(rect.y + rect.height).toBeLessThanOrEqual(group.frame.y + group.frame.height);
            }
        });
    });

    it("never overlaps frames, or items within a frame", () => {
        for (const [a, b] of pairs(layout.groups.map((g) => g.frame))) expect(overlaps(a, b)).toBe(false);
        for (const rects of itemRects) for (const [a, b] of pairs(rects)) expect(overlaps(a, b)).toBe(false);
    });

    it("starts at the origin, with bounds covering every frame", () => {
        expect(layout.bounds).toMatchObject({ x: 100, y: -50 });
        expect(union([layout.bounds, ...layout.groups.map((g) => g.frame)])).toEqual(layout.bounds);
    });

    it("wraps into rows and stays wider than tall", () => {
        expect(layout.bounds.width).toBeGreaterThanOrEqual(layout.bounds.height);
        expect(new Set(layout.groups.map((g) => g.frame.y)).size).toBeGreaterThan(1);
    });
});

describe("layoutGroups with mixed sizes", () => {
    it("gives a wide image its own row instead of widening every cell", () => {
        const image = { id: "img", width: 960, height: 640 };
        const notes = range(6).map((i) => ({ id: `n${i}`, ...NOTE }));
        const [group] = layoutGroups([[image, ...notes]], { x: 0, y: 0 }).groups;
        const columns = [...new Set(group.items.filter((p) => p.id !== "img").map((p) => p.x))].toSorted((a, b) => a - b);
        // Notes sit one note-width apart, not one image-width apart.
        expect(columns.slice(1).map((x, i) => x - columns[i])).toEqual(columns.slice(1).map(() => NOTE.width + 24));
        expect(group.frame.width).toBe(960 + 2 * 40);
    });

    it("keeps the grid of uniform notes", () => {
        const notes = range(6).map((i) => ({ id: `n${i}`, ...NOTE }));
        const [group] = layoutGroups([notes], { x: 0, y: 0 }).groups;
        expect(new Set(group.items.map((p) => p.y)).size).toBe(2);
        expect(new Set(group.items.map((p) => p.x)).size).toBe(3);
    });
});

describe("layoutGroups with large groups", () => {
    const columns = (count: number) => {
        const [group] = layoutGroups([range(count).map((i) => ({ id: `n${i}`, ...NOTE }))], { x: 0, y: 0 }).groups;
        return new Set(group.items.map((item) => item.x)).size;
    };

    it("keeps small groups at up to four columns", () => {
        expect([1, 4, 6, 13].map(columns)).toEqual([1, 3, 3, 4]);
    });

    it("lays a big group out near square rather than as a tower", () => {
        const [group] = layoutGroups([range(67).map((i) => ({ id: `n${i}`, ...NOTE }))], { x: 0, y: 0 }).groups;
        const ratio = group.frame.width / group.frame.height;
        expect(ratio).toBeGreaterThan(0.8);
        expect(ratio).toBeLessThan(1.6);
    });
});

describe("inflate", () => {
    it("grows a rect on every side", () => {
        expect(inflate({ x: 0, y: 0, width: 10, height: 10 }, 5)).toEqual({ x: -5, y: -5, width: 20, height: 20 });
    });
});

describe("moveLayout", () => {
    it("translates frames and items together", () => {
        const layout = layoutGroups([[{ id: "a", ...NOTE }], [{ id: "b", ...NOTE }]], { x: 0, y: 0 });
        const moved = moveLayout(layout, { x: 1000, y: 50 });
        expect(moved.bounds).toEqual({ ...layout.bounds, x: 1000, y: 50 });
        expect(moved.groups[1].items[0].x - moved.groups[1].frame.x).toBe(layout.groups[1].items[0].x - layout.groups[1].frame.x);
        expect(moved.groups[0].frame.y).toBe(layout.groups[0].frame.y + 50);
    });
});
