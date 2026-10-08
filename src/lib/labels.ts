/**
 * Cluster labels without a generative model: candidate keyphrases come from
 * the notes themselves, then the embedding model picks the phrase that sits
 * closest to its own cluster and furthest from the others.
 */

import { maxBy, range } from "./fp.ts";
import { center, dot, mean, normalize, type Vec } from "./vectors.ts";

const STOPWORDS = new Set(
    (
        "a an and are as at be been but by can could did do does doing for from had has have " +
        "having he her here hers him his how i if in into is it its just me more most my no nor " +
        "not of off on once only or other our ours out over own same she should so some such " +
        "than that the their theirs them then there these they this those through to too under " +
        "until up very was we were what when where which while who whom why will with would you " +
        "your yours ever never always also again all any both each few many much get gets got " +
        "keep keeps make makes made way really still even want wants need needs like let lets " +
        "every per don doesn didn isn aren wasn weren can won shouldn couldn wouldn hasn haven " +
        "one two three four five six seven eight nine ten " +
        "el la los las de del en y que un una por para con al se es lo " +
        "esta este estos estas cada muy más ser estar haber sido hay puede pueden podría nos su sus ya sin " +
        "der die das und ist mit nur ein eine den dem zu von " +
        "am im an auf aus bei für wie war sind hat haben wird auch nicht sehr aber oder noch zum zur"
    ).split(" ")
);

type Token = { word: string; start: number; end: number };

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/** Words, where a hyphen or slash joins words into one ("on-call", "CI/CD"). */
const tokens = (text: string): Token[] =>
    [...segmenter.segment(text)]
        .filter((s) => s.isWordLike)
        .reduce<Token[]>((acc, s) => {
            const last = acc.at(-1);
            const end = s.index + s.segment.length;
            return last && /^[-/‐‑]$/.test(text.slice(last.end, s.index))
                ? [...acc.slice(0, -1), { word: text.slice(last.start, end).toLowerCase(), start: last.start, end }]
                : [...acc, { word: s.segment.toLowerCase(), start: s.index, end }];
        }, []);

/** Stopwords, numbers, single letters, and contractions of stopwords ("let's", "don't"). */
const isNoise = (word: string): boolean =>
    STOPWORDS.has(word) || STOPWORDS.has(word.split(/['’]/)[0]) || /^\d+$/.test(word) || [...word].length < 2;

/**
 * Phrases of 1-3 words that do not start or end on a stopword, as written
 * between their words ("on-call", "CI/CD"; Thai and Japanese without
 * spaces), lowercased.
 */
export const phrasesOf = (text: string): string[] => {
    const toks = tokens(text);
    const extend = (from: number): string[] =>
        range(Math.min(3, toks.length - from))
            .map((len) => toks.slice(from, from + len + 1))
            .filter((span) =>
                span.slice(1).every((t, i) => !/[.,;:!?()[\]"“”]/.test(text.slice(span[i].end, t.start)))
            )
            .filter((span) => !isNoise(span[span.length - 1].word))
            .map((span) =>
                text
                    .slice(span[0].start, span[span.length - 1].end)
                    .replace(/\s+/g, " ")
                    .toLowerCase()
            );
    return [
        ...new Set(toks.flatMap((t, i) => (isNoise(t.word) ? [] : extend(i)))),
    ];
};

const SCRIPTS: [string, RegExp][] = [
    ["latin", /\p{Script=Latin}/u],
    ["thai", /\p{Script=Thai}/u],
    ["cjk", /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
    ["hangul", /\p{Script=Hangul}/u],
    ["cyrillic", /\p{Script=Cyrillic}/u],
    ["arabic", /\p{Script=Arabic}/u],
];

/** The writing system most of `text`'s letters belong to. */
export const scriptOf = (text: string): string =>
    maxBy(
        SCRIPTS.map(([name, re]) => ({ name, count: [...text].filter((ch) => re.test(ch)).length })),
        (s) => s.count
    )?.name ?? "latin";

const majorityScript = (texts: readonly string[]): string =>
    scriptOf(texts.join(" "));

export type Candidate = { phrase: string; df: number };

/**
 * Words too general to name a group on their own ("new", "week"), though
 * they may be part of a longer label ("new hires").
 */
const WEAK = new Set(
    (
        "new old week weeks day days time times hour hours minute minutes month year today " +
        "real big small huge half whole great good best better bad next last first middle " +
        "lot lots thing things stuff people team teams work anything everything nothing " +
        "took kept run ran went came during after before below above while"
    ).split(" ")
);

/**
 * How much a phrase of 1, 2 or 3 words is worth as a label: a group of notes
 * is usually named by a word or two they share, not by one note's clause.
 */
const LENGTH_WEIGHT = [1, 0.8, 0.5];

/**
 * Ranks phrases for each cluster by how many of its notes use them, weighted
 * by how specific they are to it (c-TF-IDF in spirit) and preferring short
 * ones. Phrases in the cluster's main writing system come first, so a mostly
 * English group is not named after its one Thai note.
 */
export const labelCandidates = (clusters: readonly (readonly string[])[], perCluster = 10): Candidate[][] => {
    const labelable = (phrase: string) => phrase.includes(" ") || !WEAK.has(phrase);
    const phraseSets = clusters.map((texts) => texts.map((t) => new Set(phrasesOf(t).filter(labelable))));
    const clustersWith = phraseSets
        .map((sets) => new Set(sets.flatMap((s) => [...s])))
        .flatMap((set) => [...set])
        .reduce((m, p) => m.set(p, (m.get(p) ?? 0) + 1), new Map<string, number>());

    return phraseSets.map((sets, c) => {
        const script = majorityScript(clusters[c]);
        const df = sets
            .flatMap((s) => [...s])
            .reduce((m, p) => m.set(p, (m.get(p) ?? 0) + 1), new Map<string, number>());
        return [...df.entries()]
            .map(([phrase, count]) => ({
                phrase,
                df: count,
                native: scriptOf(phrase) === script,
                score:
                    count *
                    Math.log(1 + clusters.length / clustersWith.get(phrase)!) *
                    LENGTH_WEIGHT[phrase.split(" ").length - 1],
            }))
            .sort(
                (a, b) =>
                    Number(b.native) - Number(a.native) ||
                    b.score - a.score ||
                    a.phrase.localeCompare(b.phrase)
            )
            .slice(0, perCluster)
            .map(({ phrase, df: n }) => ({ phrase, df: n }));
    });
};

/**
 * Score bonus per doubling of the notes that share a phrase: a word several
 * notes use names a group better than one note's word, however close.
 */
const SHARED_BONUS = 0.12;

/**
 * Picks one label per cluster: the candidate closest to its own cluster and
 * furthest from the others, compared in the centered space the clustering
 * used, with a bonus for phrases several notes share. No two clusters get
 * the same label. `candidateVectors[c][i]` embeds `candidates[c][i]`.
 */
export const pickLabels = (
    itemVectors: readonly Vec[],
    assignments: readonly number[],
    k: number,
    candidates: readonly (readonly Candidate[])[],
    candidateVectors: readonly (readonly Vec[])[]
): (string | null)[] => {
    const origin = mean(itemVectors);
    const centered = center(itemVectors, origin);
    const centroids = range(k).map((c) =>
        normalize(mean(centered.filter((_, i) => assignments[i] === c)))
    );
    const ranked = candidates.map((list, c) =>
        list
            .map((candidate, i) => {
                const v = center([candidateVectors[c][i]], origin)[0];
                const own = dot(v, centroids[c]);
                const others = Math.max(
                    0,
                    ...range(k).filter((j) => j !== c).map((j) => dot(v, centroids[j]))
                );
                return {
                    phrase: candidate.phrase,
                    score: own - 0.5 * others + SHARED_BONUS * Math.log2(candidate.df),
                };
            })
            .sort((a, b) => b.score - a.score)
    );

    // Greedy across clusters, most confident first, so a contested phrase
    // goes to the cluster it fits best.
    const order = range(k).sort(
        (a, b) => (ranked[b][0]?.score ?? -Infinity) - (ranked[a][0]?.score ?? -Infinity)
    );
    const { labels } = order.reduce(
        ({ labels, taken }, c) => {
            const pick = ranked[c].find((x) => !taken.has(x.phrase));
            return pick
                ? {
                      labels: labels.map((label, i) => (i === c ? pick.phrase : label)),
                      taken: new Set(taken).add(pick.phrase),
                  }
                : { labels, taken };
        },
        { labels: new Array<string | null>(k).fill(null), taken: new Set<string>() }
    );
    return labels;
};

/** "delivery fee" -> "Delivery fee". */
export const capitalize = (phrase: string): string =>
    phrase.charAt(0).toLocaleUpperCase() + phrase.slice(1);

/** A phrase as the notes write it ("ci" -> "CI", "slack" -> "Slack"). */
export const writtenAs = (phrase: string, texts: readonly string[]): string => {
    const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
    const found = texts.flatMap((text) => {
        const written = text.replace(/\s+/g, " ");
        const lower = written.toLowerCase();
        // Lowercasing can change a string's length; then the positions no longer line up.
        if (lower.length !== written.length) return [];
        return [...lower.matchAll(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].map((m) => {
            const at = m.index;
            const whole = !isWordChar(written[at - 1]) && !isWordChar(written[at + phrase.length]);
            return { text: written.slice(at, at + phrase.length), whole, first: at === 0 };
        });
    });
    // A whole word ("CI") over the same letters inside another ("deCIsions"),
    // and mid-sentence over a note's first word, capitalized only by grammar.
    const best = found.find((f) => f.whole && !f.first) ?? found.find((f) => f.whole) ?? found[0];
    if (!best) return phrase;
    const acronym = /^\p{Lu}{2}/u.test(best.text);
    return best.first && !acronym ? best.text.charAt(0).toLocaleLowerCase() + best.text.slice(1) : best.text;
};

/** A group name as the notes write it, with a capital first letter. */
export const displayLabel = (phrase: string, texts: readonly string[]): string =>
    capitalize(writtenAs(phrase, texts));
