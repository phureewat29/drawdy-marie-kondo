/**
 * Lays clustered items out as rows of frames, one per cluster, with the items
 * of each in a grid. Pure geometry in canvas units. (The group's name is the
 * frame's own name, which Drawdy draws above the frame.)
 */

import { sum } from "./fp.ts";

export type Rect = { x: number; y: number; width: number; height: number };
export type Sized = { id: string; width: number; height: number };
export type Placed = { id: string; x: number; y: number };

export type GroupLayout = { frame: Rect; items: Placed[] };

export type Layout = { groups: GroupLayout[]; bounds: Rect };

export type LayoutOptions = {
    padding: number;
    gap: number;
    groupGap: number;
    maxColumns: number;
};

const DEFAULTS: LayoutOptions = {
    padding: 40,
    gap: 24,
    groupGap: 96,
    // Up to 13 notes this is still at most 4 columns; larger groups stay
    // square instead of growing into a tower.
    maxColumns: 12,
};

/** Columns that keep a group roughly square, wider than tall. */
const columnsFor = (count: number, maxColumns: number): number =>
    Math.max(1, Math.min(maxColumns, Math.ceil(Math.sqrt(count * 1.2))));

const median = (xs: readonly number[]): number => {
    const sorted = xs.toSorted((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

/**
 * One group at the origin: items packed into rows at their own widths, so a
 * wide image takes a row of its own instead of widening every cell. A row is
 * as wide as `columnsFor` typical items, or the widest item if that is wider.
 */
const layoutGroup = (items: readonly Sized[], o: LayoutOptions) => {
    const columns = columnsFor(items.length, o.maxColumns);
    const rowWidth = Math.max(
        Math.max(...items.map((i) => i.width)),
        columns * median(items.map((i) => i.width)) + (columns - 1) * o.gap
    );
    const span = (row: readonly Sized[]) => sum(row.map((i) => i.width)) + (row.length - 1) * o.gap;
    const rows = items.reduce<Sized[][]>((acc, item) => {
        const row = acc.at(-1);
        return row && span([...row, item]) <= rowWidth ? [...acc.slice(0, -1), [...row, item]] : [...acc, [item]];
    }, []);
    const rowHeights = rows.map((row) => Math.max(...row.map((i) => i.height)));
    const placed = rows.flatMap((row, r) =>
        row.map((item, c) => ({
            id: item.id,
            x: o.padding + sum(row.slice(0, c).map((i) => i.width + o.gap)),
            y: o.padding + sum(rowHeights.slice(0, r)) + r * o.gap,
        }))
    );
    const width = 2 * o.padding + Math.max(...rows.map(span));
    const height = 2 * o.padding + sum(rowHeights) + (rows.length - 1) * o.gap;
    return { width, height, placed };
};

const shift = (rect: Rect, dx: number, dy: number): Rect => ({
    ...rect,
    x: rect.x + dx,
    y: rect.y + dy,
});

/**
 * Places groups left to right from `origin`, wrapping to a new row once a
 * row is wider than a target that keeps the whole layout near 16:10.
 */
export const layoutGroups = (
    groups: readonly (readonly Sized[])[],
    origin: { x: number; y: number },
    options: Partial<LayoutOptions> = {}
): Layout => {
    const o = { ...DEFAULTS, ...options };
    const shapes = groups.map((items) => layoutGroup(items, o));
    const area = sum(shapes.map((s) => (s.width + o.groupGap) * (s.height + o.groupGap)));
    const targetWidth = Math.max(
        Math.max(...shapes.map((s) => s.width)),
        Math.sqrt(area * 1.6)
    );

    // Flow layout: accumulate rows of shapes, then position them.
    const rows = shapes.reduce<number[][]>((acc, shape, i) => {
        const current = acc[acc.length - 1];
        const used = current ? sum(current.map((j) => shapes[j].width + o.groupGap)) : Infinity;
        return used + shape.width > targetWidth
            ? [...acc, [i]]
            : [...acc.slice(0, -1), [...current, i]];
    }, []);

    const rowTops = rows.map((_, r) =>
        sum(rows.slice(0, r).map((row) => Math.max(...row.map((i) => shapes[i].height)) + o.groupGap))
    );
    const laidOut = rows.flatMap((row, r) =>
        row.map((i, position) => {
            const left = sum(row.slice(0, position).map((j) => shapes[j].width + o.groupGap));
            const frame: Rect = {
                x: origin.x + left,
                y: origin.y + rowTops[r],
                width: shapes[i].width,
                height: shapes[i].height,
            };
            return {
                index: i,
                group: {
                    frame,
                    items: shapes[i].placed.map((p) => ({ id: p.id, x: frame.x + p.x, y: frame.y + p.y })),
                },
            };
        })
    );
    const ordered = laidOut.sort((a, b) => a.index - b.index).map(({ group }) => group);

    const right = Math.max(...ordered.map((g) => g.frame.x + g.frame.width));
    const bottom = Math.max(...ordered.map((g) => g.frame.y + g.frame.height));
    return {
        groups: ordered,
        bounds: { x: origin.x, y: origin.y, width: right - origin.x, height: bottom - origin.y },
    };
};

/** The same layout, moved so its bounds start at `origin`. */
export const moveLayout = (layout: Layout, origin: { x: number; y: number }): Layout => {
    const dx = origin.x - layout.bounds.x;
    const dy = origin.y - layout.bounds.y;
    return {
        bounds: shift(layout.bounds, dx, dy),
        groups: layout.groups.map((g) => ({
            frame: shift(g.frame, dx, dy),
            items: g.items.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
        })),
    };
};

/** The smallest rect containing all `rects`. */
export const union = (rects: readonly Rect[]): Rect => {
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
};

export const inflate = (rect: Rect, by: number): Rect =>
    shift({ ...rect, width: rect.width + 2 * by, height: rect.height + 2 * by }, -by, -by);
