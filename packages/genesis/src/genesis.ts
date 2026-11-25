// Genesis (05 §6): a symbolic data file, compiled to concrete ids and
// addresses before anything is written. Addresses are predictable (01 §2), so
// the compiler knows every address in advance, which is what lets the
// meta-type reference itself and types reference each other by name.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  addr,
  formatAddress,
  parseAddress,
  type Address,
  type Id,
  type JsonValue,
} from "@ev/core";
import type { LogStore, LogWriter } from "@ev/log";

export interface GenesisFile {
  readonly format: 1;
  readonly name: string;
  readonly time: string;
  readonly protocol: { readonly meta: string; readonly grant: string; readonly revoke: string; readonly delete: string };
  readonly identities: readonly { readonly name: string; readonly initiator: string | null; readonly message?: string }[];
  readonly events: readonly {
    readonly name?: string;
    readonly app: string;
    readonly user: string;
    readonly type: string;
    readonly ref?: string;
    readonly payload: JsonValue;
  }[];
}

export interface PlannedIdentity {
  readonly name: string;
  readonly id: Id;
  readonly initiator: Id;
  readonly message?: string;
}

export interface PlannedEvent {
  readonly name: string | null;
  readonly app: Id;
  readonly address: Address;
  readonly typeRef: Address;
  readonly ref: Address | null;
  readonly payload: JsonValue;
}

export interface GenesisPlan {
  readonly name: string;
  readonly time: string;
  readonly identities: readonly PlannedIdentity[];
  readonly events: readonly PlannedEvent[];
  /** Symbol table: "@id:creator" -> "1", "@type:post" -> "1/23/1/1". */
  readonly symbols: ReadonlyMap<string, string>;
  readonly protocol: { readonly meta: Address; readonly grant: Address; readonly revoke: Address; readonly delete: Address };
}

const SYMBOL_RE = /^@(id|type|event):([a-z0-9][a-z0-9._-]*)$/;

export class GenesisError extends Error {}

/** The genesis file shipped with the repo. */
export function loadDefaultGenesis(): GenesisFile {
  const path = fileURLToPath(new URL("../genesis.v1.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as GenesisFile;
}

/** Resolves every symbol and assigns ids and addresses. Pure: same file + firstIdentity ⇒ same plan. */
export function compileGenesis(file: GenesisFile, firstIdentity: Id): GenesisPlan {
  if (file.format !== 1) throw new GenesisError(`unsupported genesis format ${String(file.format)}`);
  const symbols = new Map<string, string>();

  // Identities: the first is the creator at firstIdentity, the rest next-free.
  const identities: PlannedIdentity[] = [];
  let next = firstIdentity;
  for (const [i, def] of file.identities.entries()) {
    const sym = `@id:${def.name}`;
    if (symbols.has(sym)) throw new GenesisError(`duplicate identity ${def.name}`);
    if (i === 0 && def.initiator !== null) throw new GenesisError("the first identity (the creator) has no initiator");
    if (i > 0 && def.initiator === null) throw new GenesisError(`identity ${def.name} needs an initiator`);
    symbols.set(sym, (next).toString());
    next += 1n;
  }
  for (const def of file.identities) {
    const id = BigInt(symbols.get(`@id:${def.name}`)!);
    const initiator = def.initiator === null ? 0n : resolveId(def.initiator, symbols);
    identities.push(def.message === undefined ? { name: def.name, id, initiator } : { name: def.name, id, initiator, message: def.message });
  }

  // Events: predict addresses with per-app batch counters (instant batching, seq 1).
  const counters = new Map<Id, bigint>();
  const predicted: { def: GenesisFile["events"][number]; app: Id; address: Address }[] = [];
  for (const def of file.events) {
    const app = resolveId(def.app, symbols);
    const user = resolveId(def.user, symbols);
    const batch = (counters.get(app) ?? 0n) + 1n;
    counters.set(app, batch);
    const address = addr(app, batch, user, 1n);
    if (def.name !== undefined) {
      const sym = `@${def.name}`;
      if (!SYMBOL_RE.test(sym) || sym.startsWith("@id:")) throw new GenesisError(`bad event name ${def.name}`);
      if (symbols.has(sym)) throw new GenesisError(`duplicate event name ${def.name}`);
      symbols.set(sym, formatAddress(address));
    }
    predicted.push({ def, app, address });
  }

  const events: PlannedEvent[] = predicted.map(({ def, app, address }) => ({
    name: def.name ?? null,
    app,
    address,
    typeRef: resolveAddress(def.type, symbols),
    ref: def.ref === undefined ? null : resolveAddress(def.ref, symbols),
    payload: resolvePayload(def.payload, symbols),
  }));

  return {
    name: file.name,
    time: file.time,
    identities,
    events,
    symbols,
    protocol: {
      meta: resolveAddress(file.protocol.meta, symbols),
      grant: resolveAddress(file.protocol.grant, symbols),
      revoke: resolveAddress(file.protocol.revoke, symbols),
      delete: resolveAddress(file.protocol.delete, symbols),
    },
  };
}

function lookup(sym: string, symbols: ReadonlyMap<string, string>): string {
  const v = symbols.get(sym);
  if (v === undefined) throw new GenesisError(`unknown symbol ${sym}`);
  return v;
}

function resolveId(sym: string, symbols: ReadonlyMap<string, string>): Id {
  if (!sym.startsWith("@id:")) throw new GenesisError(`expected an identity symbol, got ${sym}`);
  return BigInt(lookup(sym, symbols));
}

function resolveAddress(sym: string, symbols: ReadonlyMap<string, string>): Address {
  if (!SYMBOL_RE.test(sym) || sym.startsWith("@id:")) throw new GenesisError(`expected an event symbol, got ${sym}`);
  return parseAddress(lookup(sym, symbols));
}

function resolvePayload(v: JsonValue, symbols: ReadonlyMap<string, string>): JsonValue {
  if (typeof v === "string") return SYMBOL_RE.test(v) ? lookup(v, symbols) : v;
  if (Array.isArray(v)) return v.map((x) => resolvePayload(x, symbols));
  if (v !== null && typeof v === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, x] of Object.entries(v)) out[k] = resolvePayload(x, symbols);
    return out;
  }
  return v;
}

/**
 * Writes genesis into an empty log, all in block 1 at the genesis time, then
 * opens block 2. Checks that every event lands at its predicted address.
 */
export async function seedGenesis(store: LogStore, writer: LogWriter, plan: GenesisPlan): Promise<void> {
  for await (const _ of store.blocks()) throw new GenesisError("the log is not empty");
  await writer.sealBlock(plan.time); // opens block 1
  for (const ident of plan.identities) {
    const input = ident.message === undefined
      ? { initiator: ident.initiator, id: ident.id }
      : { initiator: ident.initiator, id: ident.id, message: ident.message };
    await writer.createIdentity(input);
  }
  for (const ev of plan.events) {
    const written = await writer.emitEvent(ev.app, {
      user: ev.address.user,
      typeRef: ev.typeRef,
      ref: ev.ref,
      createdAt: plan.time,
      payload: ev.payload,
    });
    if (formatAddress(written.address) !== formatAddress(ev.address)) {
      throw new GenesisError(`${ev.name ?? "event"} landed at ${formatAddress(written.address)}, expected ${formatAddress(ev.address)}`);
    }
  }
  await writer.sealBlock(plan.time); // opens block 2: genesis is block 1
}
