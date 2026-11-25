// Event addresses: `app/batch/user/seq` (01 §2). Four 64-bit integers, kept as
// BigInt everywhere; the string form exists only at the edges (URLs, payloads,
// display) in one canonical format.

export type Id = bigint;

export interface Address {
  readonly app: Id;
  readonly batch: Id;
  readonly user: Id;
  readonly seq: Id;
}

const MAX_U64 = (1n << 64n) - 1n;

export function addr(app: Id | number, batch: Id | number, user: Id | number, seq: Id | number): Address {
  return { app: BigInt(app), batch: BigInt(batch), user: BigInt(user), seq: BigInt(seq) };
}

/** Canonical string form, e.g. "7/42/5/1". Also used as a map key. */
export function formatAddress(a: Address): string {
  return `${a.app}/${a.batch}/${a.user}/${a.seq}`;
}

/** Alias of formatAddress, for use as a Map/Set key. */
export const addressKey = formatAddress;

const ADDRESS_RE = /^(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/;

/** Parses the canonical form. Rejects leading zeros, signs and anything else. */
export function parseAddress(s: string): Address {
  const m = ADDRESS_RE.exec(s);
  if (!m) throw new Error(`invalid address: ${JSON.stringify(s)}`);
  const parts = m.slice(1, 5).map((p) => BigInt(p!));
  for (const p of parts) if (p > MAX_U64) throw new Error(`address part out of range: ${s}`);
  return addr(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
}

export function isAddressString(s: string): boolean {
  if (!ADDRESS_RE.test(s)) return false;
  try {
    parseAddress(s);
    return true;
  } catch {
    return false;
  }
}

export function addressEquals(a: Address | null | undefined, b: Address | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.app === b.app && a.batch === b.batch && a.user === b.user && a.seq === b.seq;
}

/** Total order on addresses (lexicographic on the four parts). Not the replay order. */
export function compareAddress(a: Address, b: Address): number {
  for (const k of ["app", "batch", "user", "seq"] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}

/** Event addresses use 1.. in every position; 0 is reserved (01 §2). */
export function isEventAddress(a: Address): boolean {
  return a.app > 0n && a.batch > 0n && a.user > 0n && a.seq > 0n && a.app <= MAX_U64 && a.batch <= MAX_U64 && a.user <= MAX_U64 && a.seq <= MAX_U64;
}

/** The null identity (system), e.g. the initiator of the creator's creation. */
export const NULL_IDENTITY: Id = 0n;
