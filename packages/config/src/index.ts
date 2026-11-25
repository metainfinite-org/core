// deployment.yml (07 §11): the deployment's parameters. Secrets come from the
// environment, never from this file.

import { readFileSync } from "node:fs";
import { parse } from "yaml";

export interface DeploymentConfig {
  readonly name: string;
  /** Where identity numbering starts; the creator gets this id. A genesis parameter. */
  readonly firstIdentity: bigint;
  readonly blockIntervalMs: number;
  readonly signIn: "dev" | "oidc";
  readonly storage: "memory" | "postgres";
}

export class ConfigError extends Error {}

const DEFAULTS = { name: "local", first_identity: 1, block_interval_ms: 1000, sign_in: "dev", storage: "memory" } as const;

export function parseDeploymentConfig(text: string): DeploymentConfig {
  const raw: unknown = parse(text) ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ConfigError("deployment.yml must be a mapping");
  const r = { ...DEFAULTS, ...(raw as Record<string, unknown>) };
  for (const k of Object.keys(raw)) {
    if (!(k in DEFAULTS)) throw new ConfigError(`unknown key "${k}" in deployment.yml`);
  }
  if (typeof r.name !== "string" || r.name.length === 0) throw new ConfigError("name must be a non-empty string");
  const first = r.first_identity;
  if (!((typeof first === "number" && Number.isSafeInteger(first)) || (typeof first === "string" && /^[1-9][0-9]*$/.test(first)))) {
    throw new ConfigError("first_identity must be a positive integer (use a quoted string beyond 2^53)");
  }
  const firstIdentity = BigInt(first);
  if (firstIdentity < 1n) throw new ConfigError("first_identity must be at least 1");
  if (typeof r.block_interval_ms !== "number" || !Number.isSafeInteger(r.block_interval_ms) || r.block_interval_ms < 10) {
    throw new ConfigError("block_interval_ms must be an integer ≥ 10");
  }
  if (r.sign_in !== "dev" && r.sign_in !== "oidc") throw new ConfigError('sign_in must be "dev" or "oidc"');
  if (r.storage !== "memory" && r.storage !== "postgres") throw new ConfigError('storage must be "memory" or "postgres"');
  return { name: r.name, firstIdentity, blockIntervalMs: r.block_interval_ms, signIn: r.sign_in, storage: r.storage };
}

export function loadDeploymentConfig(path: string): DeploymentConfig {
  return parseDeploymentConfig(readFileSync(path, "utf8"));
}
