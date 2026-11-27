// pnpm dev: the API server and the Vite dev server for the shell, together.
// Open http://localhost:5173. Ctrl+C stops both.

import { spawn } from "node:child_process";

const procs = [
  ["api", "pnpm", ["--filter", "@ev/server", "start"]],
  ["web", "pnpm", ["--filter", "@ev/web", "dev"]],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const tag = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join("\n") + "\n";
  p.stdout.on("data", (c) => process.stdout.write(tag(c)));
  p.stderr.on("data", (c) => process.stderr.write(tag(c)));
  p.on("exit", (code) => {
    console.log(`[${name}] exited with ${code}`);
    stop();
  });
  return p;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill();
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
