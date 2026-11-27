// Appends the visible conversation with Claude Code (the user's prompts and
// Claude's replies, no tool calls or tool output) to docs/conversation/log.md.
//
//   Stop hook:  node scripts/conversation-log.mjs        (hook JSON on stdin: transcript_path)
//   Backfill:   node scripts/conversation-log.mjs --all <dir with session .jsonl files>
//
// The log is append-only: entries are never rewritten. Each entry carries a
// hidden `<!-- msg:<uuid> -->` marker, so running the script again (or the hook
// after a missed turn) appends only what isn't there yet.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// EV_CONVERSATION_LOG overrides the output file (for testing the script).
const logPath = process.env.EV_CONVERSATION_LOG ?? path.join(repo, "docs", "conversation", "log.md");

const HEADER = `# Conversation log

The conversation with Claude Code about this project, exactly as written by both
sides: the user's prompts and Claude's replies, without tool calls or their output.
It is **append-only**, written by a Stop hook ([scripts/conversation-log.mjs](../../scripts/conversation-log.mjs),
configured in [.claude/settings.json](../../.claude/settings.json)) after every turn. Do not edit it.
It exists so that the reasoning behind the architecture can be traced later; the
architecture docs remain the source of truth. Times are UTC.
`;

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Removes editor context and wrapper tags the user didn't type; keeps what they wrote. */
function cleanUserText(t) {
  return t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "")
    .replace(/<ide_selection>([\s\S]*?)<\/ide_selection>/g, (_, s) =>
      `> *Editor selection:* ${s.trim().split(/\r?\n/).join("\n> ")}\n`)
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, "$1")
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, " $1")
    .replace(/<\/?pasted_content[^>]*>/g, "")
    .trim();
}

function textBlocks(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text);
}

/** The visible messages of one session transcript, in order. */
export function messagesOf(file) {
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // a partially written last line
    }
    if (!o.uuid || o.isSidechain || o.isMeta || o.isCompactSummary) continue;
    if (o.type === "user" && o.origin?.kind === "human") {
      const text = cleanUserText(textBlocks(o.message?.content).join("\n\n"));
      if (text) out.push({ uuid: o.uuid, who: "user", time: o.timestamp, session: o.sessionId, text });
    } else if (o.type === "assistant") {
      const text = textBlocks(o.message?.content).join("\n\n").trim();
      if (text) out.push({ uuid: o.uuid, who: "claude", time: o.timestamp, session: o.sessionId, text });
    }
  }
  return out;
}

function stamp(iso) {
  return iso ? iso.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, "") : "?";
}

/** Renders new messages; consecutive replies by Claude share one heading. */
export function render(messages) {
  let out = "";
  let prev = null;
  for (const m of messages) {
    if (m.who !== prev || m.who === "user") {
      const name = m.who === "user" ? "User" : "Claude";
      out += `\n---\n\n### ${name} · ${stamp(m.time)} · session ${String(m.session ?? "?").slice(0, 8)}\n\n`;
    } else {
      out += "\n";
    }
    out += `<!-- msg:${m.uuid} -->\n${m.text}\n`;
    prev = m.who;
  }
  return out;
}

function append(files) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const seen = new Set([...existing.matchAll(/<!-- msg:([0-9a-f-]+) -->/g)].map((m) => m[1]));
  const fresh = files.flatMap(messagesOf).filter((m) => !seen.has(m.uuid));
  if (fresh.length === 0) return 0;
  const chunk = (existing ? "" : HEADER) + render(fresh);
  fs.appendFileSync(logPath, chunk, "utf8");
  return fresh.length;
}

function firstTimestamp(file) {
  const m = fs.readFileSync(file, "utf8").match(/"timestamp":"([^"]+)"/);
  return m ? m[1] : "";
}

const args = process.argv.slice(2);
if (args[0] === "--all") {
  const dir = args[1];
  if (!dir) throw new Error("usage: --all <directory with session .jsonl files>");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f));
  files.sort((a, b) => firstTimestamp(a).localeCompare(firstTimestamp(b)));
  console.log(`appended ${append(files)} messages from ${files.length} sessions`);
} else if (args[0] !== "--lib") {
  const input = JSON.parse(readStdin() || "{}");
  if (!input.transcript_path) throw new Error("no transcript_path in the hook input");
  append([input.transcript_path]);
}
