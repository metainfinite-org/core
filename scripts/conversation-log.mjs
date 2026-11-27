// Appends the visible conversation with Claude Code (the user's prompts and
// Claude's replies, no tool calls or tool output) to docs/conversation/log.md.
//
//   Stop hook:  node scripts/conversation-log.mjs        (hook JSON on stdin: transcript_path)
//   Backfill:   node scripts/conversation-log.mjs --all <dir with session .jsonl files>
//   claude.ai:  node scripts/conversation-log.mjs --import-claude-app <conversations.json from a claude.ai export>
//               (puts that chat at the start: it came before this repository existed)
//
// The log is append-only: entries are never rewritten. Each entry carries a
// hidden `<!-- msg:<uuid> -->` marker, so running the script again (or the hook
// after a missed turn) appends only what isn't there yet.
//
// Everything written goes through redact() first: emails, passwords in URLs,
// common API key and token formats, private keys, "password: ..." values and
// the user name in home-directory paths are replaced automatically, and the
// hook tells the user when it replaced something. Your own terms (names of
// other people, internal hosts) go in .claude/conversation-redact.txt, one per
// line; that file is git-ignored, so the terms themselves never reach the repo.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// EV_CONVERSATION_LOG and EV_REDACT_TERMS override the paths (for testing the script).
const logPath = process.env.EV_CONVERSATION_LOG ?? path.join(repo, "docs", "conversation", "log.md");
const termsPath = process.env.EV_REDACT_TERMS ?? path.join(repo, ".claude", "conversation-redact.txt");

const HEADER = `# Conversation log

The conversation with Claude about this project, exactly as written by both sides:
the user's prompts and Claude's replies, without tool calls or their output.
It begins with the claude.ai chat (Sonnet 5.5, 2026-11-21 to 2026-11-24) from which
the architecture docs were first written; the Claude Code sessions follow.
It is **append-only**, written by a Stop hook ([scripts/conversation-log.mjs](../../scripts/conversation-log.mjs),
configured in [.claude/settings.json](../../.claude/settings.json)) after every turn. Do not edit it.
Personal details and secrets are redacted automatically. It exists so that the
reasoning behind the architecture can be traced later; the architecture docs
remain the source of truth. Times are UTC.
`;

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// --- redaction ----------------------------------------------------------------

function escapeRe(t) {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** [pattern, replacement] pairs for what must never reach the log. */
function redactionRules() {
  const rules = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]"],
    // scheme://user:password@host
    [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):(?!\[redacted\]@)[^\s@/]+@/gi, "$1:[redacted]@"],
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
    [/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})\b/g, "[redacted token]"],
    [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted token]"],
    // password: hunter2, API_KEY=abc...  (a value right after the name, not the word alone)
    [/\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token)(\s*[:=]\s*)(["']?)(?!\[redacted\])[^\s"',;]{4,}/gi, "$1$2$3[redacted]"],
    // the user name in home-directory paths: C:\Users\name, /c/Users/name, /home/name
    [/\b([A-Za-z]:[\\/]+Users[\\/]+)(?!<user>)[^\\/\s"'`)\]]+/gi, "$1<user>"],
    [/((?:^|[\s"'`(])\/(?:[a-z]\/)?(?:Users|home)\/)(?!<user>)[^/\s"'`)\]]+/g, "$1<user>"],
  ];
  if (fs.existsSync(termsPath)) {
    for (const line of fs.readFileSync(termsPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith("#")) rules.push([new RegExp(`(?<![\\w])${escapeRe(t)}(?![\\w])`, "gi"), "[redacted]"]);
    }
  }
  return rules;
}

let redactions = 0;

/** Replaces secrets and personal details, counting what it replaced. */
export function redact(text, rules = redactionRules()) {
  let out = text;
  for (const [re, rep] of rules) {
    const n = out.match(re)?.length ?? 0;
    if (n === 0) continue;
    redactions += n;
    out = out.replace(re, rep);
  }
  return out;
}

// --- reading transcripts -------------------------------------------------------

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

/** The visible messages of one Claude Code session transcript, in order. */
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

/** The visible messages of one claude.ai conversation (from a data export's conversations.json). */
export function claudeAppMessages(conversation) {
  const source = `claude.ai chat ${String(conversation.uuid).slice(0, 8)}`;
  const out = [];
  for (const m of conversation.chat_messages ?? []) {
    // What was typed or pasted (long pastes arrive as attachments), and Claude's
    // visible text: no thinking, tool calls, or the memory snapshots claude.ai
    // injects (`injected_prompt_block`).
    const typed = textBlocks(m.content).join("\n\n");
    const pasted = (m.attachments ?? []).map((a) => a.extracted_content ?? "").join("\n\n");
    const raw = [typed, pasted].filter((t) => t.trim()).join("\n\n").replace(/\r\n/g, "\n");
    const text = m.sender === "human" ? cleanUserText(raw) : raw.trim();
    if (text) out.push({ uuid: m.uuid, who: m.sender === "human" ? "user" : "claude", time: m.created_at, source, text });
  }
  return out;
}

// --- writing -------------------------------------------------------------------

function stamp(iso) {
  return iso ? iso.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, "") : "?";
}

/** Renders new messages; consecutive replies by Claude share one heading. */
export function render(messages) {
  const rules = redactionRules();
  let out = "";
  let prev = null;
  for (const m of messages) {
    if (m.who !== prev || m.who === "user") {
      const name = m.who === "user" ? "User" : "Claude";
      const where = m.source ?? `session ${String(m.session ?? "?").slice(0, 8)}`;
      out += `\n---\n\n### ${name} · ${stamp(m.time)} · ${where}\n\n`;
    } else {
      out += "\n";
    }
    out += `<!-- msg:${m.uuid} -->\n${redact(m.text, rules)}\n`;
    prev = m.who;
  }
  return out;
}

function seenIn(text) {
  return new Set([...text.matchAll(/<!-- msg:([0-9a-f-]+) -->/g)].map((m) => m[1]));
}

function append(files) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const seen = seenIn(existing);
  const fresh = files.flatMap(messagesOf).filter((m) => !seen.has(m.uuid));
  if (fresh.length === 0) return 0;
  const chunk = (existing ? "" : HEADER) + render(fresh);
  fs.appendFileSync(logPath, chunk, "utf8");
  return fresh.length;
}

/**
 * Puts a claude.ai chat at the start of the log (it predates the Claude Code
 * sessions). The one exception to append-only: the header is refreshed, and the
 * rest of the log is kept as it is, only redacted.
 */
function importClaudeApp(file) {
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const seen = seenIn(existing);
  const fresh = (Array.isArray(all) ? all : [all]).flatMap(claudeAppMessages).filter((m) => !seen.has(m.uuid));
  const cut = existing.indexOf("\n---\n");
  const body = cut < 0 ? "" : existing.slice(cut);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, HEADER + render(fresh) + redact(body), "utf8");
  return fresh.length;
}

function firstTimestamp(file) {
  const m = fs.readFileSync(file, "utf8").match(/"timestamp":"([^"]+)"/);
  return m ? m[1] : "";
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const args = isMain ? process.argv.slice(2) : ["--lib"];
if (args[0] === "--all") {
  const dir = args[1];
  if (!dir) throw new Error("usage: --all <directory with session .jsonl files>");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f));
  files.sort((a, b) => firstTimestamp(a).localeCompare(firstTimestamp(b)));
  console.log(`appended ${append(files)} messages from ${files.length} sessions; ${redactions} redactions`);
} else if (args[0] === "--import-claude-app") {
  if (!args[1]) throw new Error("usage: --import-claude-app <conversations.json>");
  console.log(`prepended ${importClaudeApp(args[1])} messages; ${redactions} redactions`);
} else if (args[0] !== "--lib") {
  const input = JSON.parse(readStdin() || "{}");
  if (!input.transcript_path) throw new Error("no transcript_path in the hook input");
  append([input.transcript_path]);
  // Claude Code shows `systemMessage` from a Stop hook's JSON output to the user.
  if (redactions > 0) {
    console.log(JSON.stringify({
      systemMessage: `conversation log: redacted ${redactions} item(s) (emails, secrets, home paths or terms from .claude/conversation-redact.txt)`,
    }));
  }
}
