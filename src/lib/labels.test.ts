import { describe, expect, it } from "@jest/globals";
import {
    capitalize,
    displayLabel,
    labelCandidates,
    phrasesOf,
    pickLabels,
    scriptOf,
    writtenAs,
} from "./labels.ts";
import { normalize } from "./vectors.ts";

describe("phrasesOf", () => {
    it("keeps content words and short phrases, not stopwords", () => {
        const phrases = phrasesOf("The delivery fee is way too high");
        expect(phrases).toEqual(expect.arrayContaining(["delivery", "delivery fee"]));
        expect(phrases).not.toContain("the");
        expect(phrases.some((p) => p.endsWith(" is"))).toBe(false);
    });

    it("does not join words across punctuation", () => {
        expect(phrasesOf("Refunds, slow support")).not.toContain("refunds slow");
    });

    it("segments scripts written without spaces", () => {
        const thai = phrasesOf("ค่าส่งแพงกว่าค่าอาหาร");
        expect(thai.length).toBeGreaterThan(1);
        expect(thai.every((p) => !p.includes(" "))).toBe(true);
        expect(phrasesOf("配達が遅い").some((p) => p.includes("配達"))).toBe(true);
    });
});

describe("scriptOf", () => {
    it.each([
        ["Delivery fee", "latin"],
        ["ค่าส่งแพง", "thai"],
        ["配達が遅い", "cjk"],
    ])("%s is %s", (text, script) => {
        expect(scriptOf(text)).toBe(script);
    });
});

describe("labelCandidates", () => {
    it("prefers phrases shared within a cluster and specific to it", () => {
        const [refunds] = labelCandidates([
            ["Refund took two weeks", "Give me a refund for late orders", "Refund button is hidden"],
            ["App crashes on login", "Login code never arrives"],
        ]);
        expect(refunds[0]).toEqual({ phrase: "refund", df: 3 });
    });

    it("ranks the cluster's main writing system first", () => {
        const [mixed] = labelCandidates([
            ["Prices are too high", "Prices went up again", "ค่าส่งแพง"],
            ["Rider was late"],
        ]);
        expect(scriptOf(mixed[0].phrase)).toBe("latin");
    });
});

describe("pickLabels", () => {
    const axis = (i: number, wobble = 0) =>
        normalize(Float32Array.from({ length: 4 }, (_, d) => (d === i ? 1 : 0) + (d === 3 ? wobble : 0)));

    it("picks the candidate nearest its own cluster, never twice", () => {
        const items = [axis(0, 0.1), axis(0, -0.1), axis(1, 0.1), axis(1, -0.1)];
        const labels = pickLabels(
            items,
            [0, 0, 1, 1],
            2,
            [
                [
                    { phrase: "pricing", df: 2 },
                    { phrase: "shared", df: 1 },
                ],
                [
                    { phrase: "pricing", df: 1 },
                    { phrase: "delivery", df: 2 },
                ],
            ],
            [
                [axis(0), axis(2)],
                [axis(0), axis(1)],
            ]
        );
        expect(labels).toEqual(["pricing", "delivery"]);
    });
});

describe("phrasesOf, as written", () => {
    it("keeps the punctuation inside a phrase", () => {
        expect(phrasesOf("On-call handover has no checklist")).toContain("on-call handover");
        expect(phrasesOf("Speed up CI/CD")).toContain("ci/cd");
    });

    it("skips contractions and helper words in other languages", () => {
        expect(phrasesOf("Let's stop estimating")).not.toContain("let's");
        expect(phrasesOf("Esta reunión podría haber sido un correo")).not.toContain("haber");
        expect(phrasesOf("Rufbereitschaft am Wochenende")).not.toContain("am");
    });
});

describe("displayLabel", () => {
    it("writes the label as the notes do", () => {
        expect(displayLabel("ci", ["CI takes 40 minutes"])).toBe("CI");
        expect(displayLabel("ci", ["Decisions get lost", "Cache npm in CI"])).toBe("CI");
        expect(displayLabel("ビルド", ["ビルドが遅すぎる"])).toBe("ビルド");
        expect(displayLabel("slack threads", ["Decisions in Slack threads get lost"])).toBe("Slack threads");
        expect(displayLabel("flaky tests", ["Nobody owns the flaky tests"])).toBe("Flaky tests");
        expect(displayLabel("missing", [])).toBe("Missing");
    });
});

describe("writtenAs", () => {
    it("keeps the case of a phrase mid-sentence, and of an acronym anywhere", () => {
        expect(writtenAs("deploys", ["Deploys need approval", "Ship smaller deploys"])).toBe("deploys");
        expect(writtenAs("deploys", ["Deploys need approval"])).toBe("deploys");
        expect(writtenAs("ci", ["CI is slow"])).toBe("CI");
        expect(writtenAs("missing", ["nothing here"])).toBe("missing");
    });
});

describe("capitalize", () => {
    it("uppercases the first letter only", () => {
        expect(capitalize("delivery fee")).toBe("Delivery fee");
        expect(capitalize("ค่าส่ง")).toBe("ค่าส่ง");
    });
});
