// The HTTP API's JSON shapes (07 §6), shared by the server and the web client
// so both sides agree on one contract. Ids and addresses are strings.

import type { EventJson, JsonValue } from "@ev/core/browser";

/** One displayable thing in a list or tree: a lineage, shown at its head version. */
export interface ItemJson {
  /** Lineage root: the stable handle of the item. */
  readonly address: string;
  /** Latest valid version. */
  readonly head: EventJson;
  readonly author: string;
  readonly app: string;
  /** Block and block time of the root (authoritative clock). */
  readonly block: string;
  readonly time: string;
  readonly edited: boolean;
  /** Live aggregate of the requested score type over reactions to this item (04 §10). */
  readonly score: number;
  readonly votes: number;
  /** Valid, not deleted events that reference this item. */
  readonly children: number;
  /** Tree queries only. */
  readonly replies?: readonly ItemJson[];
}

export interface StatusJson {
  readonly address: string;
  readonly valid: boolean;
  readonly reason: string | null;
  readonly head: string;
  readonly deleted: boolean;
  /** Always true with instant batching; the UI keeps the "unpublished" marker anyway (07 §2). */
  readonly published: boolean;
  readonly history?: readonly string[];
}

export interface TypeJson {
  readonly address: string;
  readonly name: string;
  readonly author: string;
  readonly extends: string | null;
  readonly versionRoot: string;
  /** Head of this type's version lineage, and whether this is it. */
  readonly head: string;
  readonly isHead: boolean;
  /** Effective schema (base schemas merged in). */
  readonly schema: { readonly [k: string]: JsonValue };
  /** The type event's own payload. */
  readonly own: JsonValue;
  /** Hints, inherited along `extends` (nearest wins), then the type's own (05 §2). */
  readonly hints: { readonly [k: string]: JsonValue };
  /** The type author's latest type view for this type, if any (05 §4). */
  readonly defaultTypeView: string | null;
  /** Number of valid instances, descendants included: the ranking signal of 05 §3. */
  readonly usage: number;
}

export interface AppJson {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly manifest: string;
  /** Native (hand-written) UI in the shell, honored only for genesis apps. */
  readonly native: string | null;
  readonly owner: string;
  /** The signed-in human may control it (IDM custody). */
  readonly mine: boolean;
}

export interface AppConfigJson {
  readonly app: string;
  readonly name: string;
  readonly native: string | null;
  readonly manifest: EventJson;
  readonly views: { readonly [address: string]: EventJson };
  readonly actions: { readonly [address: string]: EventJson };
  readonly typeViews: { readonly [address: string]: EventJson };
}

export interface MeJson {
  readonly id: string;
  readonly name: string;
}

export interface SessionJson {
  readonly me: MeJson | null;
  readonly signIn: "dev" | "oidc";
  readonly deployment: string;
  /** Genesis tool apps by their native UI name. */
  readonly tools: { readonly [native: string]: string };
  /** The deployment's feature switches (deployment.yml `features`). */
  readonly features: { readonly configApps: boolean };
  /** Genesis types by symbolic name, e.g. "vote" -> "1/27/1/1". */
  readonly genesisTypes: { readonly [name: string]: string };
}

export interface GrantJson {
  readonly address: string;
  readonly app: string;
  readonly user: string;
  readonly issuedBlock: string;
  readonly revokedBlock: string | null;
}

export interface PostEventBody {
  /** Defaults to the signed-in user. Another identity only if the IDM's custody policy lets the session control it. */
  readonly user?: string;
  readonly type: string;
  readonly ref?: string | null;
  readonly supersedes?: boolean;
  readonly payload: JsonValue;
}

export interface PostEventResult {
  readonly address: string;
  readonly auth: string | null;
}

export interface ApiError {
  readonly error: string;
  readonly reason?: string;
}
