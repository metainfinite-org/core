import { describe, expect, it } from "vitest";
import {
  addr,
  checkJsonRules,
  compareAddress,
  formatAddress,
  isEventAddress,
  parseAddress,
  stableStringify,
} from "@ev/core";

describe("addresses", () => {
  it("round-trips the canonical string form", () => {
    const a = addr(7, 42, 5, 1);
    expect(formatAddress(a)).toBe("7/42/5/1");
    expect(parseAddress("7/42/5/1")).toEqual(a);
  });

  it("handles 64-bit values without precision loss", () => {
    const big = "18446744073709551615/9007199254740993/1/1";
    expect(formatAddress(parseAddress(big))).toBe(big);
  });

  it("rejects non-canonical forms", () => {
    for (const s of ["07/1/1/1", "1/1/1", "1/1/1/1/1", "-1/1/1/1", "1/1/1/x", " 1/1/1/1", "18446744073709551616/1/1/1"]) {
      expect(() => parseAddress(s), s).toThrow();
    }
  });

  it("reserves zero in every position for event addresses", () => {
    expect(isEventAddress(addr(1, 1, 1, 1))).toBe(true);
    expect(isEventAddress(addr(1, 0, 1, 1))).toBe(false);
  });

  it("orders lexicographically", () => {
    expect(compareAddress(addr(1, 2, 3, 4), addr(1, 2, 3, 5))).toBe(-1);
    expect(compareAddress(addr(2, 0, 0, 0), addr(1, 9, 9, 9))).toBe(1);
  });
});

describe("JSON payload rules", () => {
  it("accepts plain JSON with safe integers and NFC strings", () => {
    expect(checkJsonRules({ a: [1, "x", true, null], b: { c: -5 } })).toEqual([]);
  });

  it("rejects floats, unsafe integers, non-NFC strings", () => {
    const v = checkJsonRules({ f: 1.5, big: 2 ** 60, s: "é" });
    expect(v.map((x) => x.path).sort()).toEqual(["$.big", "$.f", "$.s"]);
  });
});

describe("stableStringify", () => {
  it("is independent of key insertion order", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("distinguishes bigint from strings and sorts maps", () => {
    expect(stableStringify(1n)).not.toBe(stableStringify("1"));
    expect(stableStringify(new Map([["b", 1], ["a", 2]]))).toBe(stableStringify(new Map([["a", 2], ["b", 1]])));
  });
});
