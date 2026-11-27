// Wires a node, the IDM and the HTTP server together. Used by main.ts and by
// the integration tests (with in-memory stores).

import type { FastifyInstance } from "fastify";
import type { DeploymentConfig } from "@ev/config";
import { parseAddress } from "@ev/core";
import { Idm, MemoryIdmStore, type IdmStore } from "@ev/idm";
import type { LogStore } from "@ev/log";
import { identityOf, startNode, type EvNode } from "@ev/node";
import { buildServer } from "./server";

export interface StackOptions {
  readonly config: DeploymentConfig;
  readonly store?: LogStore;
  readonly idmStore?: IdmStore;
  readonly sessionSecret: string;
  readonly staticDir?: string;
  readonly logger?: boolean;
  readonly clock?: () => string;
}

export interface Stack {
  readonly node: EvNode;
  readonly idm: Idm;
  readonly server: FastifyInstance;
}

export async function createStack(o: StackOptions): Promise<Stack> {
  const node = await startNode({ config: o.config, ...(o.store ? { store: o.store } : {}), ...(o.clock ? { clock: o.clock } : {}) });
  const sym = (s: string) => parseAddress(node.plan.symbols.get(s)!);
  const idm = new Idm({
    id: identityOf(node, "idm"),
    writer: node.writer,
    projector: node.projector,
    sync: node.sync,
    store: o.idmStore ?? new MemoryIdmStore(),
    grantType: sym("@type:grant"),
    revokeType: sym("@type:revoke"),
  });
  const server = await buildServer({
    node, idm, sessionSecret: o.sessionSecret,
    ...(o.staticDir ? { staticDir: o.staticDir } : {}),
    ...(o.logger !== undefined ? { logger: o.logger } : {}),
  });
  return { node, idm, server };
}
