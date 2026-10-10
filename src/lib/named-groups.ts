/**
 * Manual grouping: sorting items into groups the user named.
 *
 * Each name is matched against each item the way Search matches a query, so
 * short topic names work best ("Bugs", "Pricing"). Similarity scores only
 * mean something relative to the board: some names score high against
 * everything, and no score says "fits none". So each name's scores are taken
 * relative to the rest of the board, items go to the name they fit best, and
 * each group's own items then sharpen it for a few rounds (k-means seeded by
 * the names), which recovers notes a vague name misses.
 *
 * Calibrated offline on three labelled boards (a sprint retro, app
 * feedback, offsite ideas) with 23 sets of names: see docs/development.md.
 */

import { range, sum } from "./fp.ts";
import { dot, mean, normalize, type Vec } from "./vectors.ts";

/** Where an item goes when it fits none of the names. */
export const LEFTOVER = -1;

/** The group for leftovers, unless the user named one ("Misc", "Unknown"). */
export const FALLBACK_NAME = "Other";

/** Longest name kept, and most names: a frame label, not a paragraph. */
const MAX_NAME_LENGTH = 60;
const MAX_NAMES = 20;

/** Names that ask for a group of what fits none of the others. */
const CATCH_ALL = new Set([
    "other",
    "others",
    "misc",
    "misc.",
    "miscellaneous",
    "unknown",
    "uncategorized",
    "uncategorised",
    "unsorted",
    "rest",
    "the rest",
    "everything else",
    "leftovers",
]);

/** The groups a user typed, separated by commas, semicolons or lines; repeats once. */
export const parseGroupNames = (text: string): string[] => {
    const names = text
        .split(/[,;\n]+/)
        .map((name) => name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH))
        .filter((name) => name.length > 0);
    const seen = new Set<string>();
    return names
        .filter((name) => !seen.has(name.toLowerCase()) && Boolean(seen.add(name.toLowerCase())))
        .slice(0, MAX_NAMES);
};

/** Whether a typed name asks for the leftovers ("Other", "Misc", "Unknown"). */
export const isCatchAll = (name: string): boolean => CATCH_ALL.has(name.trim().toLowerCase());

/** Half of each name's pull on every item is discounted when items first pick a name. */
const PULL_DISCOUNT = 0.5;
const ROUNDS = 3;
/** How much the name decides, against closeness to the group's own items. */
const NAME_WEIGHT = 0.4;
/** With leftovers: how clearly an item must fit to stay (standard deviations above the board). */
const CLEAR_FIT = 0.8;

const argmax = (xs: readonly number[]): number => xs.indexOf(Math.max(...xs));

/** Each column as standard scores over the rows: how an item compares with the rest of the board. */
const relativeToBoard = (rows: readonly (readonly number[])[]): number[][] => {
    const columns = range(rows[0]?.length ?? 0).map((c) => rows.map((row) => row[c]));
    const stats = columns.map((column) => {
        const average = sum(column) / column.length;
        const spread = Math.sqrt(sum(column.map((x) => (x - average) ** 2)) / column.length);
        return { average, spread: spread > 1e-9 ? spread : 1 };
    });
    return rows.map((row) => row.map((x, c) => (x - stats[c].average) / stats[c].spread));
};

/**
 * Which name each item goes to. `scores[i][g]` is how well item `i` matches
 * name `g` as a search; `views[i]` is the item's grouping vector. With
 * `leftovers`, items that fit no name clearly get `LEFTOVER`, and only clear
 * fits shape the groups. Use it when the user expects some (one name, or a
 * typed "Other"): with several names it would also drop items that belong.
 */
export const sortIntoNames = (
    scores: readonly (readonly number[])[],
    views: readonly Vec[],
    options: { leftovers: boolean }
): number[] => {
    if (scores.length === 0) return [];
    const names = range(scores[0].length);
    const pull = names.map((g) => sum(scores.map((row) => row[g])) / scores.length);
    const byName = relativeToBoard(scores);
    const first = scores.map((row) => argmax(row.map((s, g) => s - PULL_DISCOUNT * pull[g])));

    const round = ({ assigned, fit }: { assigned: number[]; fit: number[][] }) => {
        const centers = names.map((g) => {
            const members = assigned.flatMap((a, i) => (a === g && (!options.leftovers || fit[i][g] >= CLEAR_FIT) ? [views[i]] : []));
            return members.length > 0 ? normalize(mean(members)) : null;
        });
        const closeness = relativeToBoard(views.map((v) => centers.map((c) => (c ? dot(v, c) : -1))));
        const next = byName.map((row, i) => row.map((s, g) => NAME_WEIGHT * s + (1 - NAME_WEIGHT) * closeness[i][g]));
        return { assigned: next.map(argmax), fit: next };
    };
    const { assigned, fit } = range(ROUNDS).reduce(round, { assigned: first, fit: byName });
    return assigned.map((g, i) => (options.leftovers && fit[i][g] < CLEAR_FIT ? LEFTOVER : g));
};
