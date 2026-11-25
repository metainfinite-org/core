// CLI: boots a node from deployment.yml and prints what genesis produced.
//
//   pnpm start            boot, print genesis summary and projection hash
//   pnpm start demo       also write a tiny reddit-style scenario and print scores
//   pnpm start symbols    print the full genesis symbol table
//
// With `storage: postgres` in deployment.yml and DATABASE_URL set, the log
// persists: the first run seeds genesis, later runs replay the existing log.

import { resolve } from "node:path";
import { formatAddress } from "@ev/core";
import { loadDeploymentConfig } from "@ev/config";
import { PgLogStore } from "@ev/log-pg";
import { identityOf, startNode } from "./node";

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "info";
  const configPath = resolve(process.env.EV_CONFIG ?? resolve(import.meta.dirname, "../../../deployment.yml"));
  const config = loadDeploymentConfig(configPath);
  let pgStore: PgLogStore | undefined;
  if (config.storage === "postgres") {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("storage: postgres needs DATABASE_URL, e.g. postgres://user:pass@localhost:5432/ev");
    pgStore = new PgLogStore({ connectionString: url });
    await pgStore.migrate();
  }
  const node = pgStore ? await startNode({ config, store: pgStore }) : await startNode({ config });

  const p = node.projector;
  console.log(`deployment ${config.name}: ${node.seeded ? "seeded genesis" : "existing log"}`);
  console.log(`  identities ${p.identities.size}, events ${p.events.size}, types ${p.types.size}`);
  console.log(`  meta-type at ${formatAddress(node.plan.protocol.meta)}`);

  if (cmd === "symbols") {
    for (const [sym, value] of node.plan.symbols) console.log(`  ${sym.padEnd(24)} ${value}`);
  }

  if (cmd === "demo") {
    const type = (n: string) => {
      const v = node.plan.symbols.get(`@type:${n}`);
      if (!v) throw new Error(`no type ${n}`);
      return node.projector.types.get(v)!.address;
    };
    const idm = identityOf(node, "idm");
    const app = await node.writer.createIdentity({ initiator: identityOf(node, "creator") });
    const users = [await node.writer.createIdentity({ initiator: idm }), await node.writer.createIdentity({ initiator: idm })];
    const grants = [];
    for (const u of users) {
      grants.push(await node.writer.emitEvent(idm, { user: idm, typeRef: type("grant"), payload: { app: app.toString(), user: u.toString() } }));
    }
    const post = await node.writer.emitEvent(app, { user: users[0]!, typeRef: type("post"), auth: grants[0]!.address, payload: { title: "Hello, events" } });
    const comment = await node.writer.emitEvent(app, { user: users[1]!, typeRef: type("comment"), ref: post.address, auth: grants[1]!.address, payload: { body: "First comment" } });
    for (const [i, u] of users.entries()) {
      await node.writer.emitEvent(app, { user: u, typeRef: type("vote"), ref: post.address, auth: grants[i]!.address, payload: { value: 1 } });
    }
    try {
      await node.writer.emitEvent(app, { user: users[1]!, typeRef: type("post"), ref: post.address, supersedes: true, auth: grants[1]!.address, payload: { title: "hijacked" } });
    } catch (err) {
      console.log(`  insert check rejected a non-author edit: ${(err as Error).message}`);
    }
    await node.sync();
    const score = p.aggregate(post.address, type("vote"));
    console.log(`  post ${formatAddress(post.address)}: ${score.count} votes, score ${score.sum}`);
    console.log(`  comment ${formatAddress(comment.address)} -> ${p.edges.get(formatAddress(comment.address))!.dst}`);
  }

  console.log(`  projection hash ${p.hash()}`);
  node.stop();
  await pgStore?.close();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
