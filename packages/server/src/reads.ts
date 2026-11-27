// The read side (07 §3, §6): everything the API returns is derived from the
// projection here. Every read of an event goes through canRead, the read-side
// twin of authorize.

import { addressKey, eventToJson, formatAddress, parseAddress, type Address, type Id, type JsonValue } from "@ev/core";
import { compareItems, type AppConfigJson, type AppJson, type ItemJson, type SortKey, type StatusJson, type TypeJson } from "@ev/engine";
import type { GenesisPlan } from "@ev/genesis";
import type { EventRow, Projector } from "@ev/projector";

export type ReadVerdict = "ok" | "missing" | "deleted" | "invalid";

export interface QueryInput {
  readonly types: readonly string[];
  /** "none" = top-level only; an address = events referencing any version of it; undefined = any. */
  readonly ref?: string;
  readonly author?: Id;
  readonly sort: SortKey;
  readonly score?: string;
  readonly limit: number;
}

function isObj(v: unknown): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export class ReadModel {
  private readonly typeViewType: string;
  private readonly creator: Id;

  constructor(private readonly p: Projector, private readonly plan: GenesisPlan) {
    this.typeViewType = plan.symbols.get("@type:type-view")!;
    this.creator = BigInt(plan.symbols.get("@id:creator")!);
  }

  /**
   * can_read(session, event) (07 §3). The demo has no private events and no
   * moderation yet, so it hides what its author deleted; invalid events are
   * in the log but ignored by everyone. `_session` is the seam for both.
   */
  canRead(_session: Id | null, key: string): ReadVerdict {
    const row = this.p.events.get(key);
    if (!row) return "missing";
    if (!row.valid) return "invalid";
    if (this.p.isDeleted(key)) return "deleted";
    return "ok";
  }

  row(key: string): EventRow | undefined {
    return this.p.events.get(key);
  }

  blockTime(block: bigint): string {
    return this.p.blockTimes.get(block) ?? "";
  }

  status(key: string, history: boolean): StatusJson | undefined {
    const s = this.p.status(parseAddress(key));
    if (!s) return undefined;
    const out: StatusJson = {
      address: key,
      valid: s.valid,
      reason: s.reason,
      head: formatAddress(s.head),
      deleted: s.deleted,
      published: true,
      ...(history ? { history: this.p.history(key) } : {}),
    };
    return out;
  }

  /** Version roots of the given type addresses (unknown types are dropped). */
  private typeRoots(types: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const t of types) {
      const info = this.p.types.get(t);
      if (info) out.add(addressKey(info.versionRoot));
    }
    return out;
  }

  private isOfType(row: EventRow, roots: ReadonlySet<string>): boolean {
    return this.p.typeLineageKeys(row.event.typeRef).some((k) => roots.has(k));
  }

  /** Events that reference any version of `key`'s lineage. */
  private referencing(key: string): string[] {
    const out: string[] = [];
    for (const v of this.p.history(key)) out.push(...(this.p.children.get(v) ?? []));
    return out;
  }

  private sumOver(key: string, scoreType: string | undefined): { score: number; votes: number } {
    if (!scoreType || !this.p.types.has(scoreType)) return { score: 0, votes: 0 };
    let score = 0;
    let votes = 0;
    for (const v of this.p.history(key)) {
      const a = this.p.aggregate(parseAddress(v), parseAddress(scoreType));
      score += a.sum;
      votes += a.count;
    }
    return { score, votes };
  }

  private visibleChild(k: string): boolean {
    const r = this.p.events.get(k);
    return r !== undefined && r.valid && r.effective && !this.p.isDeleted(k);
  }

  /** One displayable item: a lineage at its head version. `key` may be any version. */
  item(key: string, scoreType?: string): ItemJson | undefined {
    const row = this.p.events.get(key);
    if (!row || !row.valid) return undefined;
    const root = this.p.events.get(row.lineageRoot)!;
    const head = this.p.events.get(this.p.headOf(row.lineageRoot))!;
    const { score, votes } = this.sumOver(row.lineageRoot, scoreType);
    return {
      address: row.lineageRoot,
      head: eventToJson(head.event),
      author: root.event.address.user.toString(),
      app: root.event.address.app.toString(),
      block: root.position.block.toString(),
      time: this.blockTime(root.position.block),
      edited: head !== root,
      score,
      votes,
      children: this.referencing(row.lineageRoot).filter((k) => this.visibleChild(k)).length,
    };
  }

  /** Engine queries (05 §4): events of some types (descendants included), by reference relation and author. */
  query(q: QueryInput): ItemJson[] {
    const roots = this.typeRoots(q.types);
    if (roots.size === 0) return [];
    let candidates: string[];
    if (q.ref !== undefined && q.ref !== "none") {
      if (this.canRead(null, q.ref) !== "ok") return [];
      candidates = this.referencing(q.ref);
    } else {
      const seen = new Set<string>();
      candidates = [];
      for (const t of q.types) for (const k of this.p.instancesOf(parseAddress(t))) if (!seen.has(k)) { seen.add(k); candidates.push(k); }
    }
    const items: ItemJson[] = [];
    for (const k of candidates) {
      if (!this.visibleChild(k)) continue;
      const row = this.p.events.get(k)!;
      if (!this.isOfType(row, roots)) continue;
      if (q.ref === "none" && row.event.ref !== null) continue;
      if (q.author !== undefined && row.event.address.user !== q.author) continue;
      const it = this.item(k, q.score);
      if (it) items.push(it);
    }
    items.sort((a, b) => compareItems(q.sort, a, b));
    return items.slice(0, q.limit);
  }

  /** Nested replies under `root`, each level sorted, up to `depth` levels. */
  tree(root: string, types: readonly string[], sort: SortKey, score: string | undefined, depth: number, limit: number): ItemJson[] {
    const level = (ref: string, d: number): ItemJson[] => {
      const items = this.query({ types, ref, sort, ...(score ? { score } : {}), limit });
      if (d >= depth) return items;
      return items.map((it) => ({ ...it, replies: level(it.address, d + 1) }));
    };
    return level(root, 1);
  }

  // --- types -----------------------------------------------------------------

  types(): TypeJson[] {
    const out: TypeJson[] = [];
    for (const k of this.p.types.keys()) {
      if (this.p.isDeleted(k)) continue;
      out.push(this.typeJson(k)!);
    }
    out.sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name) || (a.address < b.address ? -1 : 1));
    return out;
  }

  typeJson(key: string): TypeJson | undefined {
    const t = this.p.types.get(key);
    const row = this.p.events.get(key);
    if (!t || !row) return undefined;
    const rootKey = addressKey(t.versionRoot);
    const head = this.p.headOf(rootKey);
    // Hints: base first, so the nearest type wins (05 §2).
    const chain: string[] = [];
    let cur: string | undefined = key;
    while (cur && !chain.includes(cur)) {
      chain.unshift(cur);
      const ti = this.p.types.get(cur);
      cur = ti?.extends ? addressKey(ti.extends) : undefined;
    }
    let hints: { [k: string]: JsonValue } = {};
    for (const c of chain) {
      const p = this.p.events.get(c)?.event.payload;
      const h = isObj(p) && isObj(p.extensions) ? p.extensions.hints : undefined;
      if (isObj(h)) hints = { ...hints, ...h };
    }
    return {
      address: key,
      name: t.name,
      author: row.event.address.user.toString(),
      extends: t.extends ? addressKey(t.extends) : null,
      versionRoot: rootKey,
      head,
      isHead: head === key,
      schema: t.schema,
      own: row.event.payload,
      hints,
      defaultTypeView: this.defaultTypeView(t.versionRoot, row.event.address.user),
      usage: this.p.instancesOf(t.address).length,
    };
  }

  /** The type author's latest type view for any version of the type (05 §4). */
  private defaultTypeView(versionRoot: Address, author: Id): string | null {
    const rootKey = addressKey(versionRoot);
    let found: string | null = null;
    for (const k of this.p.instancesOf(parseAddress(this.typeViewType))) {
      const row = this.p.events.get(k)!;
      if (row.event.address.user !== author) continue;
      const head = this.p.events.get(this.p.headOf(k))!;
      const target = isObj(head.event.payload) ? head.event.payload.type : undefined;
      if (typeof target !== "string") continue;
      const tt = this.p.types.get(target);
      if (tt && addressKey(tt.versionRoot) === rootKey) found = this.p.headOf(k);
    }
    return found;
  }

  // --- apps ------------------------------------------------------------------

  private manifestPayload(app: Id): { row: EventRow; payload: { [k: string]: JsonValue } } | undefined {
    const row = this.p.manifestOf(app);
    if (!row || !isObj(row.event.payload)) return undefined;
    return { row, payload: row.event.payload };
  }

  /** Hand-coded implementations are honored only for apps the genesis creator owns. */
  kernelOf(app: Id): string | null {
    const m = this.manifestPayload(app);
    const owner = this.p.identities.get(app)?.owner;
    return m && typeof m.payload.kernel === "string" && owner === this.creator ? m.payload.kernel : null;
  }

  appName(app: Id): string | undefined {
    const m = this.manifestPayload(app);
    return m && typeof m.payload.name === "string" ? m.payload.name : undefined;
  }

  apps(controlled: ReadonlySet<Id>): AppJson[] {
    const out: AppJson[] = [];
    for (const app of this.p.appConfig.keys()) {
      const m = this.manifestPayload(app);
      if (!m) continue;
      out.push({
        id: app.toString(),
        name: typeof m.payload.name === "string" ? m.payload.name : `app ${app}`,
        description: typeof m.payload.description === "string" ? m.payload.description : "",
        manifest: addressKey(m.row.event.address),
        kernel: this.kernelOf(app),
        owner: (this.p.identities.get(app)?.owner ?? 0n).toString(),
        mine: controlled.has(app),
      });
    }
    // Tools first, then by id.
    out.sort((a, b) => (a.kernel ? 0 : 1) - (b.kernel ? 0 : 1) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    return out;
  }

  appConfig(app: Id): AppConfigJson | undefined {
    const m = this.manifestPayload(app);
    if (!m) return undefined;
    const pick = (addrs: Iterable<unknown>): { [k: string]: ReturnType<typeof eventToJson> } => {
      const out: { [k: string]: ReturnType<typeof eventToJson> } = {};
      for (const a of addrs) {
        if (typeof a !== "string" || this.canRead(null, a) !== "ok") continue;
        out[a] = eventToJson(this.p.events.get(a)!.event);
      }
      return out;
    };
    const p = m.payload;
    const list = (v: JsonValue | undefined) => (Array.isArray(v) ? v : []);
    const values = (v: JsonValue | undefined) => (isObj(v) ? Object.values(v) : []);
    return {
      app: app.toString(),
      name: typeof p.name === "string" ? p.name : `app ${app}`,
      kernel: this.kernelOf(app),
      manifest: eventToJson(m.row.event),
      views: pick([...list(p.views), ...(typeof p.home === "string" ? [p.home] : []), ...values(p.open)]),
      actions: pick(list(p.actions)),
      typeViews: pick(values(p.typeViews)),
    };
  }

  /** Display names for identities the log itself can name: genesis identities and apps. */
  logNames(ids: readonly Id[]): Map<Id, string> {
    const out = new Map<Id, string>();
    for (const id of ids) {
      const app = this.appName(id);
      if (app) out.set(id, app);
      else {
        const g = this.plan.identities.find((i) => i.id === id);
        if (g) out.set(id, g.name);
      }
    }
    return out;
  }
}
