// The single default IDM of the demo (03 §1, §4; 07 §7). It owns every user
// account and every app made with the App Maker, issues grants lazily and
// auto-approved, revokes them, and keeps the custody policy. Everything it
// does to the log goes through the writer like any other app: it creates
// identities with create_identity and emits grant/revoke events in its own
// batches, so the projection is still the only authority on validity.

import { formatAddress, type Address, type Id } from "@ev/core";
import type { LogWriter } from "@ev/log";
import type { GrantRow, Projector } from "@ev/projector";
import type { IdmStore } from "./store";

export interface IdmOptions {
  /** The IDM's own identity. */
  readonly id: Id;
  readonly writer: LogWriter;
  readonly projector: Projector;
  /** Catches the projector up after a write. */
  readonly sync: () => Promise<void>;
  readonly store: IdmStore;
  readonly grantType: Address;
  readonly revokeType: Address;
}

export class IdmError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 = 400) {
    super(message);
  }
}

export class Idm {
  readonly id: Id;
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(private readonly o: IdmOptions) {
    this.id = o.id;
  }

  /** Same key ⇒ one run at a time (in this process), so concurrent requests don't create twins. */
  private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.pending.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const settled = run.catch(() => undefined);
    this.pending.set(key, settled);
    void settled.then(() => {
      if (this.pending.get(key) === settled) this.pending.delete(key);
    });
    return run;
  }

  /** Sign-in (07 §7): finds the subject's account or creates it (create_identity, owner = this IDM). */
  signIn(subject: string, name: string): Promise<Id> {
    return this.once(`account:${subject}`, async () => {
      const existing = await this.o.store.findAccount(subject);
      if (existing !== undefined) return existing;
      const id = await this.o.writer.createIdentity({ initiator: this.id });
      await this.o.store.linkAccount(subject, id, name);
      await this.o.sync();
      return id;
    });
  }

  async names(ids: readonly Id[]): Promise<Map<Id, string>> {
    return this.o.store.names(ids);
  }

  /** True if this IDM currently owns the identity on-chain. */
  owns(identity: Id): boolean {
    return this.o.projector.identities.get(identity)?.owner === this.id;
  }

  /**
   * Lazy grant issuance (03 §4): a usable grant for (app, user), issued by the
   * user's current owner. Reuses an existing one; otherwise this IDM emits a
   * new grant, auto-approved, in its own batch.
   */
  ensureGrant(app: Id, user: Id): Promise<Address> {
    return this.once(`grant:${app}|${user}`, async () => {
      const usable = this.usableGrant(app, user);
      if (usable) return usable.address;
      if (!this.owns(user)) throw new IdmError(`identity ${user} is not owned by this IDM, so it can't grant for it`, 403);
      if (!this.o.projector.identities.has(app)) throw new IdmError(`app ${app} does not exist`, 404);
      const g = await this.o.writer.emitEvent(this.id, {
        user: this.id,
        typeRef: this.o.grantType,
        payload: { app: app.toString(), user: user.toString() },
      });
      await this.o.sync();
      return g.address;
    });
  }

  /** A valid, unrevoked grant issued by the user's current owner (03 §5), if one exists. */
  usableGrant(app: Id, user: Id): GrantRow | undefined {
    const owner = this.o.projector.identities.get(user)?.owner;
    return this.o.projector.grantsFor(app, user).find((g) => g.issuer === owner);
  }

  /** Every grant ever issued for `user`, newest first. */
  grantsOf(user: Id): GrantRow[] {
    return [...this.o.projector.grants.values()].filter((g) => g.user === user).reverse();
  }

  /**
   * Revocation (03 §4): a revoke event by the owner referencing the grant.
   * `requester` must be the grant's user or control it (custody).
   */
  async revoke(grant: Address, requester: Id): Promise<Address> {
    const g = this.o.projector.grants.get(formatAddress(grant));
    if (!g) throw new IdmError("not a grant", 404);
    if (!(await this.controls(requester, g.user))) throw new IdmError("only the grant's user can revoke it", 403);
    if (g.revokedBlock !== null) throw new IdmError("already revoked");
    if (!this.owns(g.user)) throw new IdmError("this IDM no longer owns the user", 403);
    const r = await this.o.writer.emitEvent(this.id, { user: this.id, typeRef: this.o.revokeType, ref: grant, payload: {} });
    await this.o.sync();
    return r.address;
  }

  /**
   * App creation (05 §7, 07 §7): a new identity owned by this IDM, with the
   * creating human recorded as allowed to control it.
   */
  async createApp(human: Id): Promise<Id> {
    const app = await this.o.writer.createIdentity({ initiator: this.id });
    await this.o.store.addCustody(app, human, "owner");
    await this.o.sync();
    return app;
  }

  /** The custody policy: may `human` act as `identity`? Everyone controls themselves. */
  async controls(human: Id, identity: Id): Promise<boolean> {
    if (human === identity) return true;
    return (await this.o.store.custodians(identity)).includes(human);
  }

  async controlled(human: Id): Promise<Id[]> {
    return this.o.store.custodyOf(human);
  }
}
