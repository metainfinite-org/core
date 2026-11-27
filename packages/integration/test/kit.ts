// Test kit: an in-memory node with genesis seeded and a projector caught up.

import { formatAddress, parseAddress, type Address, type EventRecord, type Id, type JsonValue } from "@ev/core";
import { compileGenesis, loadDefaultGenesis, seedGenesis, type GenesisPlan } from "@ev/genesis";
import { LogWriter, MemoryLogStore, type EmitInput } from "@ev/log";
import { Projector } from "@ev/projector";

export interface Kit {
  store: MemoryLogStore;
  writer: LogWriter;
  plan: GenesisPlan;
  proj: Projector;
  type(name: string): Address;
  id(name: string): Id;
  /** The IDM creates an account it owns. */
  newUser(): Promise<Id>;
  /** The creator creates an app identity (owned by the creator). */
  newApp(): Promise<Id>;
  /** The user's IDM grants `app` the right to post for `user`. */
  grant(app: Id, user: Id): Promise<EventRecord>;
  revoke(grant: EventRecord): Promise<EventRecord>;
  emit(app: Id, input: Omit<EmitInput, "typeRef"> & { type: string | Address }): Promise<EventRecord>;
  /** Catches the projector up and returns the event's row. */
  sync(): Promise<void>;
  verdict(e: EventRecord): Promise<string>;
}

export async function boot(firstIdentity = 1n): Promise<Kit> {
  const store = new MemoryLogStore();
  let tick = 0;
  const clock = () => new Date(Date.UTC(2026, 0, 2, 0, 0, 0, tick++)).toISOString();
  const writer = new LogWriter(store, { firstIdentity, clock });
  const plan = compileGenesis(loadDefaultGenesis(), firstIdentity);
  await seedGenesis(store, writer, plan);
  const proj = new Projector({ protocol: plan.protocol });
  await proj.catchUp(store);

  const type = (name: string) => parseAddress(plan.symbols.get(`@type:${name}`) ?? fail(`no type ${name}`));
  const id = (name: string) => BigInt(plan.symbols.get(`@id:${name}`) ?? fail(`no identity ${name}`));
  const idm = id("idm");
  const creator = id("creator");

  const kit: Kit = {
    store, writer, plan, proj, type, id,
    newUser: () => writer.createIdentity({ initiator: idm }),
    newApp: () => writer.createIdentity({ initiator: creator }),
    grant: (app, user) =>
      writer.emitEvent(idm, { user, typeRef: type("grant"), payload: { app: app.toString(), user: user.toString() } }),
    revoke: (g) =>
      writer.emitEvent(idm, { user: g.address.user, typeRef: type("revoke"), ref: g.address, payload: {} }),
    emit: (app, input) => {
      const { type: t, ...rest } = input;
      return writer.emitEvent(app, { ...rest, typeRef: typeof t === "string" ? type(t) : t });
    },
    sync: () => proj.catchUp(store),
    async verdict(e) {
      await proj.catchUp(store);
      const row = proj.events.get(formatAddress(e.address));
      if (!row) return "missing";
      return row.valid ? "valid" : row.reason!;
    },
  };
  return kit;
}

function fail(msg: string): never {
  throw new Error(msg);
}

export function payload(v: JsonValue): JsonValue {
  return v;
}
