import { describe, expect, it } from "@jest/globals";
import { clamp, debounce, hash, maxBy, range, serial, sleep, splitBy, sum, uniqBy } from "./fp.ts";

describe("collection helpers", () => {
    it("builds ranges and sums", () => {
        expect(range(4)).toEqual([0, 1, 2, 3]);
        expect(sum([1, 2, 3.5])).toBe(6.5);
        expect(clamp(12, 0, 10)).toBe(10);
    });

    it("splits by lengths", () => {
        expect(splitBy(["a", "b", "c", "d"], [1, 3])).toEqual([["a"], ["b", "c", "d"]]);
    });

    it("deduplicates by key, keeping the first occurrence", () => {
        expect(uniqBy([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }], (x) => x.k)).toEqual([
            { k: "a", v: 1 },
            { k: "b", v: 2 },
        ]);
    });

    it("finds the maximum by a score", () => {
        expect(maxBy(["aa", "a", "aaa"], (s) => s.length)).toBe("aaa");
        expect(maxBy([], () => 0)).toBeUndefined();
    });

    it("hashes stably", () => {
        expect(hash("note")).toBe(hash("note"));
        expect(hash("note")).not.toBe(hash("notes"));
    });
});

describe("serial", () => {
    it("runs jobs one at a time, in order, past failures", async () => {
        const run = serial();
        const log: string[] = [];
        const job = (name: string, ms: number, fail = false) => async () => {
            await sleep(ms);
            log.push(name);
            if (fail) throw new Error(name);
        };
        await Promise.allSettled([run(job("a", 20)), run(job("b", 1, true)), run(job("c", 1))]);
        expect(log).toEqual(["a", "b", "c"]);
    });
});

describe("debounce", () => {
    it("calls once with the last arguments after calls stop", async () => {
        const calls: number[] = [];
        const debounced = debounce((n: number) => calls.push(n), 10);
        debounced(1);
        debounced(2);
        debounced(3);
        await sleep(30);
        expect(calls).toEqual([3]);
    });
});
