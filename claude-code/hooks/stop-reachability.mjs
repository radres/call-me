#!/usr/bin/env node

// Stop hook shipped with the Call Me plugin — the reachability backstop.
//
// The problem: "call me when you need input" is a rule the model can only obey
// while a turn is running. Once the turn ends the model is asleep, so a question
// it parked in its final message is never followed by a call. Prose in SKILL.md
// cannot fix that; it needs a harness event at the moment the model stops.
//
// The Stop event is exactly that moment. This hook fires there and hands the
// decision back to the model with `decision: block` — the model has the context
// to know whether contact is warranted, a shell script does not.
//
// CRITICAL DESIGN RULE: this hook NEVER dials. It resolves the paired number
// only to check that a phone exists at all, and it never scans other sessions'
// state to find one. The v0.3.0 Notification hook did both (it rang the phone
// itself, and its number fallback read the newest state file of ANY session, so
// on a shared machine it could ring a stranger) and was deleted for it. A
// reminder cannot ring the wrong person.
//
// Opt out entirely with CALLME_NO_STOP_REMINDER=1.
// Debounce (default 15 min per session) via CALLME_STOP_REMINDER_DEBOUNCE=<seconds>.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  alwaysRemind,
  isValidNumber,
  reachStampPath,
  resolveUserNumber,
  stateDir,
} from "../lib/callme-config.mjs";

const DEBOUNCE_S = numberFromEnv("CALLME_STOP_REMINDER_DEBOUNCE", 900);
// A send this recent means the model already reached out during this very turn,
// so reminding it would just waste a turn telling it to do what it just did.
const ALREADY_REACHED_WINDOW_S = numberFromEnv("CALLME_STOP_REMINDER_REACHED_WINDOW", 300);

const REMINDER =
  "You are about to end your turn with an open question, and your human is not " +
  "watching the terminal. Reach them on their phone now with the Call Me skill — " +
  "text first, call if it is genuinely blocking or time-sensitive. If no contact " +
  "is actually needed, say so in one short line and stop.";

// Deliberately narrow. A false positive costs one wasted sentence; being noisy
// is the failure mode that got the last backstop deleted, so the bar is "the
// model clearly parked something on the human", not "the text contains a ?".
const PARKED_PATTERNS = [
  /\blet me know\b/i,
  /\bwhich (?:one )?would you (?:prefer|like)\b/i,
  /\bwaiting (?:for|on) (?:you|your)\b/i,
  /\bblocked on\b/i,
  /\bshould i\b/i,
  /\bshall i\b/i,
  /\bwant me to\b/i,
  /\bdo you want\b/i,
  /\byour call\b/i,
  /\bup to you\b/i,
  /\bneed your (?:input|decision|answer|call|go-ahead)\b/i,
  /\bconfirm (?:this|that|before)\b/i,
];

// Everything below must fail silently: a reachability backstop that can break a
// turn is worse than no backstop at all.
main().catch(() => process.exit(0));

async function main() {
  if (process.env.CALLME_NO_STOP_REMINDER === "1") return;

  const input = parseJson(await readStdin());
  if (!input) return;

  // Loop guard: we already blocked once for this stop, the model has been told.
  if (input.stop_hook_active === true) return;

  const sessionId = String(input.session_id || "").replace(/[^A-Za-z0-9-]/g, "");
  const cwd = typeof input.cwd === "string" ? input.cwd : "";

  // Scope. By default only sessions that actually opted into Call Me get a nudge:
  // the per-session state file is written by the MCP server / monitor on first
  // real use, so its existence is the same signal that scopes the monitor to
  // on-skill-invoke, and a session that never touched the skill stays silent.
  //
  // That default has an onboarding hole, though — a human who is usually away
  // wants the backstop in sessions that would never think to mention Call Me at
  // all. `callme remind on` sets always_remind for exactly that case.
  if (!alwaysRemind() && !optedInStateFile(sessionId, cwd)) return;

  // A phone must be paired — but resolved ONLY through the shared precedence
  // rules (env override -> config.json -> this session's own legacy file).
  // No scanning of other sessions. Ever.
  if (!isValidNumber(resolveUserNumber({ projectDir: cwd || undefined }).number)) return;

  if (!looksParked(input.last_assistant_message)) return;

  // The model already texted or called within this turn — nothing to remind.
  if (reachedOutRecently(sessionId, cwd)) return;

  if (!claimDebounce(sessionId, cwd)) return;

  process.stdout.write(`${JSON.stringify({ decision: "block", reason: REMINDER })}\n`);
}

/**
 * The state file for THIS session, if it exists. Mirrors stateFileFor() in
 * lib/callme-config.mjs, but keyed off the hook payload rather than
 * CLAUDE_CODE_SESSION_ID, which hook processes are not guaranteed to inherit.
 */
function optedInStateFile(sessionId, cwd) {
  for (const file of stateKeyCandidates(sessionId, cwd).map(
    (key) => join(stateDir(), `claude-${key.kind}-${key.value}.json`),
  )) {
    if (existsSync(file)) return file;
  }
  return null;
}

function stateKeyCandidates(sessionId, cwd) {
  const candidates = [];
  if (sessionId) candidates.push({ kind: "session", value: sessionId });
  if (cwd) candidates.push({ kind: "channel", value: cwd.replace(/[^A-Za-z0-9]+/g, "-") });
  return candidates;
}

/** Stamp key: per Claude session, falling back to the project. */
function stampKey(sessionId, cwd) {
  if (sessionId) return sessionId;
  if (cwd) return cwd.replace(/[^A-Za-z0-9]+/g, "-");
  return "session";
}

function reachedOutRecently(sessionId, cwd) {
  const at = parseJson(readFileQuiet(reachStampPath(stampKey(sessionId, cwd))))?.at;
  if (!Number.isFinite(at)) return false;
  return Date.now() - at < ALREADY_REACHED_WINDOW_S * 1000;
}

/**
 * One reminder per session per debounce window. Writing the stamp is what
 * claims it, so a barrage of question-shaped turns produces a single nudge.
 */
function claimDebounce(sessionId, cwd) {
  const dir = join(stateDir(), "hook-stamps");
  const stamp = join(dir, `stop-${stampKey(sessionId, cwd)}`);
  try {
    if (existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < DEBOUNCE_S * 1000) {
      return false;
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(stamp, `${new Date().toISOString()}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Does the model's own final message look like it parked something on the human?
 * Code blocks are stripped first — a `?` inside a snippet is not a question, and
 * neither is a "should I" in a quoted diff.
 */
function looksParked(message) {
  if (typeof message !== "string" || !message.trim()) return false;

  const prose = message
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^\s*>.*$/gm, " ");

  // Only the closing stretch matters: that is where a parked question lands.
  const tail = prose.slice(-600);
  if (/\?\s*$/.test(tail.trimEnd())) return true;

  // A question is not always the very last character. The real miss that
  // motivated this: "1. License type — MIT, Apache 2.0, or something else?
  // 2. Copyright holder name — the name to put in the copyright line." The
  // question is on its own line and the message ends on a statement, so the
  // trailing-? test above and every stock phrase below all fail, and the human
  // was never contacted. A line that ends in `?` is a question being asked —
  // prose almost never breaks a line there otherwise, so this stays narrow.
  if (tail.split("\n").some((line) => /\?$/.test(line.trimEnd()))) return true;

  return PARKED_PATTERNS.some((pattern) => pattern.test(tail));
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    // No stdin (hook run by hand, or a host that pipes nothing) must not hang.
    const done = setTimeout(() => resolve(data), 2_000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        clearTimeout(done);
        resolve(data);
      }
    });
    process.stdin.on("end", () => {
      clearTimeout(done);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(done);
      resolve(data);
    });
  });
}

function readFileQuiet(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function numberFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
