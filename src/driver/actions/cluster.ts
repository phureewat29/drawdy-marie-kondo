import { clusterVectors, type Clustering } from "../../lib/cluster.ts";
import { bestGroup, claimNotes, CONCEPTS, describeGroups, nameGroups } from "../../lib/concepts.ts";
import { hash, maxBy, partition, range, splitBy } from "../../lib/fp.ts";
import { displayLabel, labelCandidates, pickLabels } from "../../lib/labels.ts";
import { layoutGroups, moveLayout, union, type Layout } from "../../lib/layout.ts";
import { FALLBACK_NAME, isCatchAll, LEFTOVER, parseGroupNames, sortIntoNames } from "../../lib/named-groups.ts";
import { center, concatenate, dot, type Vec } from "../../lib/vectors.ts";
import type { ClusterSummary } from "../../shared/protocol.ts";
import { framesLeftEmpty, noteKey, readSelectedItems, type BoardItem, type GroupFrame } from "../board.ts";
import { focus } from "../camera.ts";
import type { Context } from "../context.ts";
import type { Ddp } from "../ddp.ts";
import { readable } from "../embeddings.ts";
import { groupFrame } from "../frame.ts";
import { glide, type Move } from "../motion.ts";
import { findFreeSpot } from "../space.ts";

const MIN_ITEMS = 4;
/** Grouping is O(n²) in time and memory; past this it would stall the board. */
const MAX_ITEMS = 1000;

/** Names each group of notes with a phrase from its own notes, or a plain fallback. */
const labelGroups = async (
    ctx: Context,
    groups: readonly BoardItem[][],
    vectors: readonly Vec[],
    clustering: Clustering
): Promise<string[]> => {
    const candidates = labelCandidates(groups.map((group) => group.map((i) => i.text)));
    const phrases = candidates.flat().map((c) => c.phrase);
    const phraseVectors = splitBy(await ctx.embeddings.texts("clustering", phrases), candidates.map((c) => c.length));
    return pickLabels(vectors, clustering.assignments, clustering.k, candidates, phraseVectors).map(
        (label, c) => (label ? displayLabel(label, groups[c].map((i) => i.text)) : `Group ${c + 1}`)
    );
};

/** Groups peel off one after another; within a group the stagger is capped, so big groups land in time. */
const movesFor = (layout: Layout): Move[] =>
    layout.groups.flatMap((group, g) =>
        group.items.map((placed, i) => ({
            id: placed.id,
            to: { x: placed.x, y: placed.y },
            delayMs: g * 90 + Math.min(i, 40) * 14,
        }))
    );

type NewFrame = GroupFrame & { items: readonly BoardItem[] };

/**
 * Where each item ends up: its place in the layout, inside its group's
 * frame. Nothing else about it changes (its colour stays its own). One
 * update, so one step in Drawdy's undo.
 */
const placeItems = (ctx: Context, frames: readonly NewFrame[], layout: Layout) => {
    const target = new Map(layout.groups.flatMap((g) => g.items.map((placed) => [placed.id, placed] as const)));
    return ctx.ddp.call("command:scene:update-drawdy-elements", {
        updates: frames.flatMap((frame) =>
            frame.items.map((item) => {
                const { x, y } = target.get(item.id)!;
                return {
                    drawdyElementId: item.id,
                    properties: { transform: { x, y }, frameId: frame.id },
                };
            })
        ),
    });
};

/**
 * Removes those of `frames` that are still empty: a note dropped into one
 * while grouping ran keeps it.
 */
const removeEmptyFrames = async (ddp: Ddp, frames: readonly GroupFrame[]): Promise<void> => {
    if (frames.length === 0) return;
    const { drawdyElements } = await ddp.call("command:scene:get-drawdy-elements", { properties: ["frameId"] });
    const parents = new Set(drawdyElements.map((e) => e.frameId));
    const empty = frames.filter((f) => !parents.has(f.id));
    if (empty.length > 0) {
        await ddp.call("command:scene:remove-drawdy-elements", { drawdyElementIds: empty.map((f) => f.id) });
    }
};

/** "1 note", "30 notes". */
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** "30 notes", "1 note and 2 images": what a grouping is working on. */
const countPhrase = (items: readonly BoardItem[]): string => {
    const images = items.filter((i) => i.kind === "image").length;
    const notes = items.length - images;
    if (images === 0) return plural(notes, "note");
    if (notes === 0) return plural(images, "image");
    return `${plural(notes, "note")} and ${plural(images, "image")}`;
};

/** What identifies an item's content, for ordering and seeding. */
const contentKey = (item: BoardItem) => (item.kind === "image" ? `image:${item.id}` : item.text);

type Group = {
    items: BoardItem[];
    label: string;
    /** The group for what fit none of the user's groups. */
    leftover?: boolean;
};

/**
 * Photos, grouped by look: four or more by clustering, fewer as one group.
 * Photos come in small sets (two of the same dish), so groups of two are
 * allowed, where notes need three.
 */
const photoClusters = (vectors: readonly Vec[], options: { seed: number }): number[][] => {
    if (vectors.length === 0) return [];
    if (vectors.length < MIN_ITEMS) return [range(vectors.length)];
    const clustering = clusterVectors(vectors, { ...options, minGroupSize: 2 });
    return range(clustering.k).map((c) => range(vectors.length).filter((i) => clustering.assignments[i] === c));
};

/**
 * Puts photos and notes together. Photos are grouped by what they show and
 * named after a concept (Pizza, Delivery riders, Cats); EmbeddingGemma puts
 * images and text in one space, so concepts embedded as search queries
 * describe them. Photos and notes meet only on a clear search hit (see
 * `CLEAR_HIT`): card photos join the checkout notes, cat photos among app
 * feedback stay a group of their own.
 *
 * When notes lead, each photo group joins a note group or stands alone. When
 * photos lead (fewer than four notes), each note joins the photo group that
 * clearly finds it, and the rest stay together.
 */
const withPhotos = async (
    ctx: Context,
    photos: { items: readonly BoardItem[]; vectors: readonly Vec[] },
    noteGroups: readonly Group[],
    options: { seed: number; notesLead: boolean }
): Promise<Group[]> => {
    if (photos.items.length === 0) return [...noteGroups];
    const concepts = await ctx.embeddings.texts(
        "query",
        CONCEPTS.map((c) => c.toLowerCase())
    );
    const clusters = photoClusters(photos.vectors, { seed: options.seed });
    const describe = (groups: readonly number[][]) =>
        describeGroups(
            groups.map((members) => members.map((i) => photos.vectors[i])),
            concepts
        );
    const described = describe(clusters);
    const leading = described.map((ranked) => ranked.slice(0, 3));
    const notes = noteGroups.flatMap((g) => g.items);
    const documents = notes.length > 0 ? await ctx.embeddings.texts("document", notes.map((n) => n.text)) : [];
    const photoGroup = (members: readonly number[], name: number): Group => ({
        items: members.map((i) => photos.items[i]),
        label: CONCEPTS[name],
    });

    if (options.notesLead) {
        const groupOf = noteGroups.flatMap((g, n) => g.items.map(() => n));
        const joined = noteGroups.map((g) => [...g.items]);
        const alone = clusters.filter((members, c) => {
            const g = bestGroup(leading[c], concepts, documents, groupOf);
            if (g >= 0) joined[g].push(...members.map((i) => photos.items[i]));
            return g < 0;
        });
        const names = nameGroups(describe(alone));
        return [
            ...noteGroups.map((g, n) => ({ ...g, items: joined[n] })),
            ...alone.map((members, a) => photoGroup(members, names[a])),
        ];
    }

    // Photos lead: notes join the photo group that clearly finds them.
    const claims = claimNotes(leading, concepts, documents);
    const names = nameGroups(described);
    const loose = notes.filter((_, j) => claims[j] < 0);
    return [
        ...clusters.map((members, c) => ({
            items: [...members.map((i) => photos.items[i]), ...notes.filter((_, j) => claims[j] === c)],
            label: CONCEPTS[names[c]],
        })),
        ...(loose.length > 0 ? [{ items: loose, label: "Notes" }] : []),
    ];
};

type Progress = {
    /** What is being grouped, as the status line says it ("30 notes"). */
    what: string;
    /** Reports reading progress between two fractions of the whole read. */
    reading: (from: number, to: number) => (fraction: number) => void;
};

type Sorted = {
    groups: Group[];
    unreadable: number;
    /** The user's groups nothing fit. */
    unmatched: string[];
};

/**
 * Groups by meaning: clusters the notes, names each group from its own
 * notes, and lets photos join the notes they are clearly about.
 */
const byMeaning = async (ctx: Context, items: readonly BoardItem[], { what, reading }: Progress): Promise<Sorted> => {
    // Notes, text and shapes are grouped by what they say, photos by what
    // they show; photos clearly about some notes join them.
    const [images, texts] = partition(items, (i) => i.kind === "image");
    // Reading progress: an image weighs about as much as a note's two views.
    const total = 2 * images.length + 2 * texts.length;
    const imagesDone = (2 * images.length) / total;
    const topicDone = imagesDone + texts.length / total;
    const photos = readable(images, await ctx.embeddings.items("clustering", images, reading(0, imagesDone)));
    const sayings = texts.map((t) => t.text);
    // Two views of each note, centered and joined: steadier groups than
    // either prompt alone (see README, "How it works").
    const byTopic = await ctx.embeddings.texts("clustering", sayings, reading(imagesDone, topicDone));
    const byClass = await ctx.embeddings.texts("classification", sayings, reading(topicDone, 1));

    ctx.busy(`Grouping ${what}…`);
    // Seeded by content, notes and photos apart: the same notes group the
    // same way whatever photos sit beside them.
    const seedOf = (xs: readonly BoardItem[]) => hash(xs.map(contentKey).join("\n"));
    // Notes lead when there are enough of them to group by meaning.
    const notesLead = texts.length >= MIN_ITEMS;
    const textClustering: Clustering = notesLead
        ? clusterVectors(concatenate([center(byTopic), center(byClass)]), { seed: seedOf(texts) })
        : { k: texts.length > 0 ? 1 : 0, assignments: texts.map(() => 0), silhouette: 0 };
    const clustered = range(textClustering.k).map((c) => texts.filter((_, i) => textClustering.assignments[i] === c));
    const labels = notesLead ? await labelGroups(ctx, clustered, byTopic, textClustering) : clustered.map(() => "Notes");
    const noteGroups = clustered.map((members, g) => ({ items: members, label: labels[g] }));
    return {
        groups: await withPhotos(ctx, photos, noteGroups, { seed: seedOf(photos.items), notesLead }),
        unreadable: images.length - photos.items.length,
        unmatched: [],
    };
};

/**
 * Groups into the names the user typed (see lib/named-groups.ts): each item
 * goes to the name it fits best. One name, or a typed catch-all ("Other"),
 * means some items are expected to fit none; those get a group of their own
 * instead of joining the nearest name.
 */
const byNames = async (
    ctx: Context,
    items: readonly BoardItem[],
    typed: readonly string[],
    { what, reading }: Progress
): Promise<Sorted> => {
    const names = typed.filter((name) => !isCatchAll(name));
    const leftovers = names.length === 1 || typed.some(isCatchAll);
    const [images, texts] = partition(items, (i) => i.kind === "image");
    // Reading progress: an image weighs about as much as a note's three views.
    const total = 3 * images.length + 3 * texts.length;
    const imagesDone = (3 * images.length) / total;
    const step = (n: number) => imagesDone + (n * texts.length) / total;
    const photos = readable(images, await ctx.embeddings.items("clustering", images, reading(0, imagesDone)));
    const sayings = texts.map((t) => t.text);
    // Names are matched like searches; the notes' grouping views (as for
    // Group by meaning) let each group's own notes sharpen it.
    const documents = await ctx.embeddings.texts("document", sayings, reading(imagesDone, step(1)));
    const byTopic = await ctx.embeddings.texts("clustering", sayings, reading(step(1), step(2)));
    const byClass = await ctx.embeddings.texts("classification", sayings, reading(step(2), 1));
    const queries = await ctx.embeddings.texts("query", names);

    ctx.busy(`Sorting ${what}…`);
    const matches = (v: Vec) => queries.map((q) => dot(q, v));
    const textPlaces = texts.length > 0 ? sortIntoNames(documents.map(matches), concatenate([center(byTopic), center(byClass)]), { leftovers }) : [];
    // Too few photos to compare with each other: each goes to the name it matches best.
    const photoPlaces =
        photos.items.length >= MIN_ITEMS
            ? sortIntoNames(photos.vectors.map(matches), photos.vectors, { leftovers })
            : photos.vectors.map((v) => maxBy(range(names.length), (g) => dot(queries[g], v))!);
    const placed = [...texts.map((item, i) => ({ item, place: textPlaces[i] })), ...photos.items.map((item, i) => ({ item, place: photoPlaces[i] }))];
    const into = (place: number) => placed.filter((p) => p.place === place).map((p) => p.item);
    const groups = names.map((label, g) => ({ items: into(g), label }));
    return {
        groups: [...groups, { items: into(LEFTOVER), label: typed.find(isCatchAll) ?? FALLBACK_NAME, leftover: true }],
        unreadable: images.length - photos.items.length,
        unmatched: groups.filter((g) => g.items.length === 0).map((g) => g.label),
    };
};

const quoted = (names: readonly string[]) => names.map((name) => `“${name}”`).join(names.length === 2 ? " or " : ", ");

/** How to group: by meaning, or into the groups the user typed in `groups`. */
export type GroupRequest = { groups?: string };

/**
 * Groups the selection, by meaning or into the user's own groups, and
 * glides the items into a named frame per group.
 */
export const clusterSelection = async (ctx: Context, request: GroupRequest = {}): Promise<ClusterSummary[] | null> => {
    const typed = request.groups === undefined ? null : parseGroupNames(request.groups);
    if (typed !== null && typed.every(isCatchAll)) {
        ctx.notify("Type the groups to sort into first, like “Bugs, Ideas, Praise”.", "info");
        return null;
    }
    // In content order, with a content seed: the same notes always group the
    // same way, however they were selected.
    const items = (await readSelectedItems(ctx.ddp))
        .filter((i) => !i.locked)
        .toSorted((a, b) => contentKey(a).localeCompare(contentKey(b)) || a.id.localeCompare(b.id));
    const copies = new Map<string, BoardItem[]>();
    items.forEach((item) => copies.set(noteKey(item), [...(copies.get(noteKey(item)) ?? []), item]));
    const distinct = [...copies.values()].map((same) => same[0]);
    if (distinct.length < MIN_ITEMS) {
        ctx.notify(`Select at least ${MIN_ITEMS} different notes or images, then group them.`, "info");
        return null;
    }
    if (distinct.length > MAX_ITEMS) {
        const max = MAX_ITEMS.toLocaleString("en-US");
        ctx.notify(`Janitor groups up to ${max} notes at a time. Select fewer, then try again.`, "info");
        return null;
    }
    const what = countPhrase(items);
    await ctx.highlight.clear();
    try {
        // The bar appears only once reading reports progress: short reads
        // finish without one.
        ctx.busy(`Reading ${what}…`);
        const progress: Progress = {
            what,
            reading: (from, to) => (fraction) => ctx.busy(`Reading ${what}…`, from + (to - from) * fraction),
        };
        // Copies of a note count once, so they neither sway the groups nor
        // their names, and then follow it into its group.
        const sorted = typed ? await byNames(ctx, distinct, typed, progress) : await byMeaning(ctx, distinct, progress);
        const expand = (members: readonly BoardItem[]) => members.flatMap((item) => copies.get(noteKey(item))!);
        const named = sorted.groups.map((g) => ({ ...g, items: expand(g.items) })).filter((g) => g.items.length > 0);
        const { unmatched } = sorted;
        if (named.every((g) => g.leftover)) {
            ctx.notify(`Nothing fit ${quoted(unmatched)}, so nothing moved.`, "info");
            return null;
        }
        const groups = named.map((g) => g.items);
        const moving = groups.flat();

        // Lay the groups out where the notes are, unless that would cover
        // something else on the board. Regrouping replaces the frames it
        // empties, so the new groups can take their place.
        const replaced = await framesLeftEmpty(ctx.ddp, moving);
        const start = union([...moving.map((i) => i.rect), ...replaced.map((f) => f.rect)]);
        const draft = layoutGroups(
            groups.map((group) => group.map((i) => ({ id: i.id, width: i.rect.width, height: i.rect.height }))),
            { x: start.x, y: start.y }
        );
        const movable = new Set([...moving, ...replaced].map((x) => x.id));
        const layout = moveLayout(draft, await findFreeSpot(ctx.ddp, draft.bounds, movable));
        const frames: NewFrame[] = layout.groups.map((g, c) => ({
            id: ctx.generateId(),
            rect: g.frame,
            label: named[c].label,
            items: groups[c],
        }));
        ctx.busy("Arranging…");
        // Frames first: Drawdy puts new frames beneath everything, so the notes
        // glide in over them. It also selects each one; clearing that (and the
        // notes) closes the style panel before the camera frames the view.
        await ctx.ddp.call("command:scene:add-drawdy-elements", { elements: frames.map(groupFrame) });
        await ctx.ddp.tryCall("command:scene:clear-selection");
        // Keep both where the notes are and where they go in view.
        await focus(ctx.ddp, union([start, layout.bounds]), { durationMs: 450 });
        try {
            await glide(ctx.ddp, movesFor(layout), () => placeItems(ctx, frames, layout));
        } catch (err) {
            await ctx.ddp.tryCall("command:scene:remove-drawdy-elements", { drawdyElementIds: frames.map((f) => f.id) });
            throw err;
        }
        await removeEmptyFrames(ctx.ddp, replaced);
        await focus(ctx.ddp, layout.bounds);
        const left = named.find((g) => g.leftover);
        const notes = [
            `Sorted ${what} into ${plural(groups.length, "group")}.`,
            left ? `${countPhrase(left.items)} fit none of your groups, so ${left.items.length === 1 ? "it" : "they"} went to ${left.label}.` : "",
            unmatched.length > 0 ? `Nothing fit ${quoted(unmatched)}.` : "",
            sorted.unreadable > 0 ? `${plural(sorted.unreadable, "image")} couldn't be read and stayed put.` : "",
        ];
        ctx.notify(notes.filter(Boolean).join(" "), "success");
        return frames.map((f) => ({ frameId: f.id, label: f.label, count: f.items.length }));
    } finally {
        ctx.busy(null);
    }
};
