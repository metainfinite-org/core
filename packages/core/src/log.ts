// Emulated chain structures (01 §4): blocks and transactions.

import type { Id } from "./address";
import type { JsonValue } from "./json";

export interface Block {
  readonly number: bigint;
  /** Authoritative clock (ISO 8601). */
  readonly createdAt: string;
}

export interface CreateIdentityPayload {
  readonly id: Id;
  /** Optional free-form message (e.g. a genesis message). Txs are untyped. */
  readonly message?: string;
}

export interface PublishBatchPayload {
  readonly app: Id;
  readonly batch: Id;
}

export interface TransferOwnershipPayload {
  readonly id: Id;
  readonly newOwner: Id;
}

interface TxBase {
  readonly block: bigint;
  readonly idx: number;
  readonly initiator: Id;
}

export type Tx =
  | (TxBase & { readonly type: "create_identity"; readonly payload: CreateIdentityPayload })
  | (TxBase & { readonly type: "publish_batch"; readonly payload: PublishBatchPayload })
  | (TxBase & { readonly type: "transfer_ownership"; readonly payload: TransferOwnershipPayload });

export type TxType = Tx["type"];

/** Position of something in replay order: block, tx index, then index within the batch. */
export interface Position {
  readonly block: bigint;
  readonly tx: number;
  readonly sub: number;
}

export function comparePosition(a: Position, b: Position): number {
  if (a.block !== b.block) return a.block < b.block ? -1 : 1;
  if (a.tx !== b.tx) return a.tx < b.tx ? -1 : 1;
  if (a.sub !== b.sub) return a.sub < b.sub ? -1 : 1;
  return 0;
}

export function txPayloadJson(tx: Tx): JsonValue {
  switch (tx.type) {
    case "create_identity":
      return tx.payload.message === undefined
        ? { id: tx.payload.id.toString() }
        : { id: tx.payload.id.toString(), message: tx.payload.message };
    case "publish_batch":
      return { app: tx.payload.app.toString(), batch: tx.payload.batch.toString() };
    case "transfer_ownership":
      return { id: tx.payload.id.toString(), newOwner: tx.payload.newOwner.toString() };
  }
}
