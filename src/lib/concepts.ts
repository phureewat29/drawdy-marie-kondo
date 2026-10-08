/**
 * Naming and placing groups of images by what they show. EmbeddingGemma puts
 * images and text in one space, so everyday visual concepts, embedded as
 * search queries, can describe any image the way a person would.
 */

import { range } from "./fp.ts";
import { dot, topK, type Vec } from "./vectors.ts";

/** Things a photo or a whiteboard image can show, as group names. */
export const CONCEPTS = [
    // food and drink
    "Food", "Pizza", "Burgers", "Sushi", "Noodles", "Salads", "Desserts", "Cakes", "Coffee", "Drinks", "Fruit",
    "Vegetables", "Bread", "Breakfast", "Cooking", "Restaurants", "Fast food", "Snacks",
    // people
    "People", "Portraits", "Families", "Children", "Babies", "Teams", "Crowds", "Meetings", "Workshops",
    "Students", "Athletes",
    // animals
    "Animals", "Cats", "Dogs", "Birds", "Horses", "Fish", "Insects", "Wildlife", "Pets",
    // nature
    "Nature", "Mountains", "Beaches", "Forests", "Lakes", "Rivers", "The sea", "Deserts", "Snow", "Sunsets",
    "Clouds", "Flowers", "Trees", "Gardens", "Landscapes", "Waterfalls",
    // places
    "Cities", "Streets", "Buildings", "Architecture", "Houses", "Interiors", "Offices", "Kitchens", "Shops",
    "Markets", "Bridges", "Monuments", "Churches", "Temples", "Parks",
    // transport
    "Cars", "Bicycles", "Motorbikes", "Scooters", "Buses", "Trains", "Planes", "Boats", "Trucks", "Traffic",
    "Deliveries", "Couriers", "Delivery riders",
    // tech and things
    "Phones", "Laptops", "Computers", "Screens", "Gadgets", "Cameras", "Headphones", "Watches", "Credit cards",
    "Payments", "Payment terminals", "Money", "Cash", "Receipts", "Shopping", "Packaging", "Bags", "Boxes",
    "Clothes", "Shoes", "Furniture", "Tools", "Toys", "Books", "Bottles", "Jewelry",
    // work on a whiteboard
    "Screenshots", "App screens", "Websites", "User interfaces", "Wireframes", "Sketches", "Diagrams", "Charts",
    "Graphs", "Tables", "Spreadsheets", "Documents", "Slides", "Maps", "Logos", "Icons", "Handwriting",
    "Sticky notes", "Whiteboards", "Code",
    // art
    "Art", "Paintings", "Drawings", "Illustrations", "Posters", "Patterns", "Textures",
    // events
    "Parties", "Weddings", "Concerts", "Sports", "Travel", "Festivals", "Fireworks",
    // other
    "Medicine", "Science", "Space", "Weather",
] as const;

/**
 * A search score that counts as a clear hit. Calibrated offline on three
 * boards (food delivery feedback, a team retro, city ideas) with 31 photos:
 * photo groups whose concepts found notes at this score were about those
 * notes (riders and delivery times, card photos and checkout); unrelated
 * photos (cats, mountains, flowers among app feedback) stayed below it.
 */
export const CLEAR_HIT = 0.755;

/**
 * The concepts that describe each group of images, best first: those its
 * images match more than the other groups' images do.
 */
export const describeGroups = (
    groups: readonly (readonly Vec[])[],
    concepts: readonly Vec[],
    count = 8
): number[][] => {
    const meanScore = (images: readonly Vec[], concept: Vec) =>
        images.reduce((s, v) => s + dot(v, concept), 0) / Math.max(images.length, 1);
    return groups.map((images, g) => {
        const others = groups.filter((_, h) => h !== g).flat();
        const scores = concepts.map(
            (c) => meanScore(images, c) - (others.length > 0 ? 0.5 * meanScore(others, c) : 0)
        );
        return topK(scores, count);
    });
};

/** One concept per group to name it by: its best one that no earlier group took. */
export const nameGroups = (described: readonly (readonly number[])[]): number[] => {
    const taken = new Set<number>();
    return described.map((candidates) => {
        const pick = candidates.find((c) => !taken.has(c)) ?? candidates[0];
        taken.add(pick);
        return pick;
    });
};

const topMean = (scores: readonly number[], n = 2): number => {
    const best = [...scores].sort((a, b) => b - a).slice(0, n);
    return best.length > 0 ? best.reduce((a, b) => a + b, 0) / best.length : -Infinity;
};

/**
 * Which group of notes a group of images belongs with, or -1. It joins only
 * on a clear hit: searching for one of its leading concepts must find some
 * note at `threshold`. It then joins the group its name (the first concept)
 * finds best by two notes, so one stray note cannot pull it elsewhere.
 * `documents` are the notes embedded as search documents; `groupOf` gives
 * each note's group.
 */
export const bestGroup = (
    leading: readonly number[],
    concepts: readonly Vec[],
    documents: readonly Vec[],
    groupOf: readonly number[],
    threshold = CLEAR_HIT
): number => {
    if (documents.length === 0 || leading.length === 0) return -1;
    const best = Math.max(...leading.flatMap((c) => documents.map((d) => dot(concepts[c], d))));
    if (best < threshold) return -1;
    const byName = documents.map((d) => dot(concepts[leading[0]], d));
    const groups = [...new Set(groupOf)];
    const value = (g: number) => topMean(byName.filter((_, j) => groupOf[j] === g));
    return groups.reduce((a, b) => (value(b) > value(a) ? b : a), groups[0]);
};

/**
 * For each note, the group of images whose leading concepts find it as a
 * clear search hit, or -1: how notes join photos when photos lead.
 */
export const claimNotes = (
    leading: readonly (readonly number[])[],
    concepts: readonly Vec[],
    documents: readonly Vec[],
    threshold = CLEAR_HIT
): number[] =>
    documents.map((d) => {
        const best = leading.map((group) => Math.max(...group.map((c) => dot(concepts[c], d))));
        const h = range(best.length).reduce((a, b) => (best[b] > best[a] ? b : a), 0);
        return best.length > 0 && best[h] >= threshold ? h : -1;
    });
