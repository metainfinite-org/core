import { createHash } from "node:crypto";

/** SHA-256 hex digest. Used for projection hashes (not a consensus hash yet). */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
