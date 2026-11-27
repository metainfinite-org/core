// Boots a deployment from deployment.yml and serves the API (and the built
// shell, if packages/web/dist exists).
//
//   pnpm serve                   API on http://127.0.0.1:8787
//   pnpm dev                     API + the Vite dev server for the shell
//
// Environment: DATABASE_URL (storage: postgres), PORT, HOST,
// EV_SESSION_SECRET (random per boot if unset: sessions end on restart),
// EV_CONFIG (path to deployment.yml).

import { resolve } from "node:path";
import { loadDeploymentConfig } from "@ev/config";
import { formatAddress } from "@ev/core";
import { PgIdmStore } from "@ev/idm";
import { PgLogStore } from "@ev/log-pg";
import { Sessions } from "./session";
import { createStack } from "./stack";

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "../../..");
  const config = loadDeploymentConfig(resolve(process.env.EV_CONFIG ?? resolve(root, "deployment.yml")));

  let store: PgLogStore | undefined;
  let idmStore: PgIdmStore | undefined;
  if (config.storage === "postgres") {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("storage: postgres needs DATABASE_URL, e.g. postgres://user:pass@localhost:5432/ev");
    store = new PgLogStore({ connectionString: url });
    await store.migrate();
    idmStore = new PgIdmStore({ connectionString: url });
    await idmStore.migrate();
  }

  let secret = process.env.EV_SESSION_SECRET;
  if (!secret) {
    secret = Sessions.randomSecret();
    console.log("EV_SESSION_SECRET is not set: using a random one, so sign-ins end when the server restarts");
  }

  const { node, server } = await createStack({
    config,
    sessionSecret: secret,
    staticDir: resolve(root, "packages/web/dist"),
    logger: process.env.EV_LOG === "1",
    ...(store ? { store } : {}),
    ...(idmStore ? { idmStore } : {}),
  });
  node.blocks.start();

  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  await server.listen({ port, host });
  console.log(`deployment ${config.name} (${config.storage}): ${node.seeded ? "seeded genesis" : "replayed the existing log"}`);
  console.log(`  meta-type ${formatAddress(node.plan.protocol.meta)}, projection hash ${node.projector.hash().slice(0, 16)}…`);
  console.log(`  API on http://${host}:${port}/api`);

  const stop = async () => {
    node.stop();
    await server.close();
    await store?.close();
    await idmStore?.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
