// The IDM's private records (03 §2, §8). Not in the log: which sign-in
// subject is which account, the accounts' display names, and the custody
// policy (which humans may control an identity the IDM owns, such as an app).
// On-chain ownership stays in the log; this is the IDM's own business.

import type { Id } from "@ev/core";

export type CustodyRole = "owner";

export interface IdmStore {
  /** The account a sign-in subject (e.g. "dev:alice", an OIDC `sub`) maps to. */
  findAccount(subject: string): Promise<Id | undefined>;
  /** Records a new account. Fails if the subject is already linked. */
  linkAccount(subject: string, id: Id, name: string): Promise<void>;
  names(ids: readonly Id[]): Promise<Map<Id, string>>;
  addCustody(identity: Id, human: Id, role: CustodyRole): Promise<void>;
  /** Humans who may control `identity`. */
  custodians(identity: Id): Promise<Id[]>;
  /** Identities `human` may control. */
  custodyOf(human: Id): Promise<Id[]>;
}

export class MemoryIdmStore implements IdmStore {
  private readonly accounts = new Map<string, Id>();
  private readonly nameById = new Map<Id, string>();
  private readonly custody: { identity: Id; human: Id; role: CustodyRole }[] = [];

  async findAccount(subject: string): Promise<Id | undefined> {
    return this.accounts.get(subject);
  }

  async linkAccount(subject: string, id: Id, name: string): Promise<void> {
    if (this.accounts.has(subject)) throw new Error(`subject ${subject} is already linked`);
    this.accounts.set(subject, id);
    this.nameById.set(id, name);
  }

  async names(ids: readonly Id[]): Promise<Map<Id, string>> {
    const out = new Map<Id, string>();
    for (const id of ids) {
      const n = this.nameById.get(id);
      if (n !== undefined) out.set(id, n);
    }
    return out;
  }

  async addCustody(identity: Id, human: Id, role: CustodyRole): Promise<void> {
    if (!this.custody.some((c) => c.identity === identity && c.human === human)) this.custody.push({ identity, human, role });
  }

  async custodians(identity: Id): Promise<Id[]> {
    return this.custody.filter((c) => c.identity === identity).map((c) => c.human);
  }

  async custodyOf(human: Id): Promise<Id[]> {
    return this.custody.filter((c) => c.human === human).map((c) => c.identity);
  }
}
