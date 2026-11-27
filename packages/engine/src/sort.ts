// The fixed sort menu (05 §4, demo: no expression language yet). Integer-only
// arithmetic, so every client and server orders a list identically (04 §7).

import type { ItemJson } from "./api";
import { SORT_KEYS, type SortKey } from "./blocks";

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && (SORT_KEYS as readonly string[]).includes(v);
}

const FRAC = 16;

/** floor(log2(n) * 2^16) for n >= 1, by repeated squaring on integers. */
export function log2Fixed(n: bigint): bigint {
  if (n < 1n) throw new Error("log2Fixed needs n >= 1");
  const ip = BigInt(n.toString(2).length - 1);
  const P = 62n;
  let y = (n << P) >> ip; // n / 2^ip in [1, 2), as fixed point with P bits
  let result = ip << BigInt(FRAC);
  for (let i = FRAC - 1; i >= 0; i--) {
    y = (y * y) >> P;
    if (y >= 2n << P) {
      y >>= 1n;
      result |= 1n << BigInt(i);
    }
  }
  return result;
}

/**
 * Reddit-style "hot" (sign · log10 |score| + seconds / 45000), rewritten in
 * base 2 with integers: one doubling of the score is worth 45000 · log10(2)
 * ≈ 13546 seconds of recency.
 */
export function hotRank(score: number, timeMs: number): bigint {
  const s = BigInt(Math.trunc(score));
  const mag = s < 0n ? -s : s;
  const order = log2Fixed(mag > 1n ? mag : 1n);
  const sign = s > 0n ? 1n : s < 0n ? -1n : 0n;
  const seconds = BigInt(Math.floor(timeMs / 1000));
  return sign * order + (seconds << BigInt(FRAC)) / 13546n;
}

function newer(a: ItemJson, b: ItemJson): number {
  const ba = BigInt(a.block), bb = BigInt(b.block);
  if (ba !== bb) return ba > bb ? -1 : 1;
  return a.address < b.address ? 1 : a.address > b.address ? -1 : 0;
}

export function compareItems(sort: SortKey, a: ItemJson, b: ItemJson): number {
  switch (sort) {
    case "new": return newer(a, b);
    case "old": return -newer(a, b);
    case "top": return a.score !== b.score ? b.score - a.score : newer(a, b);
    case "hot": {
      const ha = hotRank(a.score, Date.parse(a.time));
      const hb = hotRank(b.score, Date.parse(b.time));
      return ha !== hb ? (ha > hb ? -1 : 1) : newer(a, b);
    }
  }
}

export function sortItems(sort: SortKey, items: ItemJson[]): ItemJson[] {
  return items.sort((a, b) => compareItems(sort, a, b));
}
