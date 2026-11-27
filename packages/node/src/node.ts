// A node: log store + writer + projector, with genesis seeded on first boot.
// The server (P3/P4) will wrap this; the CLI uses it directly.

import { formatAddress, type Id } from "@ev/core";
import type { DeploymentConfig } from "@ev/config";
import { compileGenesis, loadDefaultGenesis, seedGenesis, type GenesisFile, type GenesisPlan } from "@ev/genesis";
import { BlockProducer, LogWriter, MemoryLogStore, type LogStore } from "@ev/log";
import { Projector } from "@ev/projector";

export interface NodeOptions {
  readonly config: DeploymentConfig;
  /** Defaults to an in-memory store. */
  readonly store?: LogStore;
  readonly genesis?: GenesisFile;
  readonly clock?: () => string;
}

export interface EvNode {
  readonly config: DeploymentConfig;
  readonly store: LogStore;
  readonly writer: LogWriter;
  readonly projector: Projector;
  readonly plan: GenesisPlan;
  readonly blocks: BlockProducer;
  /** True if this boot seeded genesis (the log was empty). */
  readonly seeded: boolean;
  /** Applies new log entries to the projection. */
  sync(): Promise<void>;
  /** Replays the whole log into a fresh projector (07 §6 rebuild) and compares it with the live one. */
  rebuild(): Promise<{ readonly hash: string; readonly live: string; readonly match: boolean }>;
  stop(): void;
}

/** The insert-time check refused an event the projection would mark invalid (04 §8). */
export class RejectedError extends Error {
  constructor(readonly address: string, readonly reason: string) {
    super(`rejected ${address}: ${reason}`);
  }
}

export async function startNode(options: NodeOptions): Promise<EvNode> {
  const { config } = options;
  const store = options.store ?? new MemoryLogStore();
  const clock = options.clock ?? (() => new Date().toISOString());
  const plan = compileGenesis(options.genesis ?? loadDefaultGenesis(), config.firstIdentity);
  const projector = new Projector({ protocol: plan.protocol });
  const writer = new LogWriter(store, {
    firstIdentity: config.firstIdentity,
    clock,
    // Insert-time validation (04 §8): reject what the projection would reject.
    // The projection stays the authority; this only fails early.
    insertCheck: async (e) => {
      await projector.catchUp(store); // reads committed entries only, so it can't see this transaction
      const v = projector.validateCandidate(e);
      if (!v.valid) throw new RejectedError(formatAddress(e.address), v.reason);
    },
  });

  let empty = true;
  for await (const _ of store.blocks()) {
    empty = false;
    break;
  }
  if (empty) {
    // Genesis is written without the insert check: the meta-type has to exist before anything can be checked.
    const genesisWriter = new LogWriter(store, { firstIdentity: config.firstIdentity, clock });
    await seedGenesis(store, genesisWriter, plan);
  }
  await projector.catchUp(store);

  const blocks = new BlockProducer(writer, config.blockIntervalMs);
  return {
    config, store, writer, projector, plan, blocks,
    seeded: empty,
    sync: () => projector.catchUp(store),
    async rebuild() {
      await projector.catchUp(store);
      const fresh = new Projector({ protocol: plan.protocol });
      await fresh.catchUp(store);
      const hash = fresh.hash();
      const live = projector.hash();
      return { hash, live, match: hash === live };
    },
    stop: () => blocks.stop(),
  };
}

export function identityOf(node: EvNode, name: string): Id {
  const v = node.plan.symbols.get(`@id:${name}`);
  if (v === undefined) throw new Error(`no genesis identity ${name}`);
  return BigInt(v);
}
