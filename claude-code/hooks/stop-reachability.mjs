#!/usr/bin/env node

// Stop hook shipped with the /call-me plugin — the reachability backstop.
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
// But that instant is TOO EARLY to reach for a phone. Most parked questions are
// answered by a human who is sitting right there and starts typing two seconds
// later; ringing them then is worse than useless. So when a waiter monitor is
// watching this session, the hook stays silent and instead ARMS a grace period
// (`armWaiter`) — see monitors/answer-waiter.mjs. Typing anything disarms it
// (hooks/answer-seen.mjs); only a window that closes unanswered escalates, and
// even then the monitor wakes the MODEL to dial. The instant reminder below is
// the fallback for when nothing is timing the window.
//
// CRITICAL DESIGN RULE: this hook NEVER dials. It resolves the paired number
// only to check that a phone exists at all, and it never scans other sessions'
// state to find one. The v0.3.0 Notification hook did both (it rang the phone
// itself, and its number fallback read the newest state file of ANY session, so
// on a shared machine it could ring a stranger) and was deleted for it. A
// reminder cannot ring the wrong person.
//
// The model can also arm the window itself with the `wait_for_answer` tool, and
// that beats everything here: it knows whether it parked a question and how long
// the answer is worth waiting for, where this file can only pattern-match its
// prose. When such an arm is live the hook does nothing at all.
//
// Opt out entirely with CALLME_NO_STOP_REMINDER=1.
// Debounce (default 15 min per session) via CALLME_STOP_REMINDER_DEBOUNCE=<seconds>.
// Grace period via CALLME_ANSWER_GRACE=<seconds> (0 or CALLME_NO_ANSWER_WAIT=1
// skips the wait and reminds at once, i.e. the pre-0.6.0 behaviour).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  alwaysRemind,
  answerGraceSeconds,
  armWaiter,
  clearWaiter,
  hookStampPath,
  isValidNumber,
  modelArmed,
  reachStampPath,
  readWaiter,
  resolveUserNumber,
  stampFresh,
  stateDir,
  stateKey,
  touchStamp,
  waiterAlive,
  waiterLapsed,
} from "../lib/callme-config.mjs";

const DEBOUNCE_S = numberFromEnv("CALLME_STOP_REMINDER_DEBOUNCE", 900);
// A send this recent means the model already reached out during this very turn,
// so reminding it would just waste a turn telling it to do what it just did.
const ALREADY_REACHED_WINDOW_S = numberFromEnv("CALLME_STOP_REMINDER_REACHED_WINDOW", 300);

const REMINDER =
  "You are about to end your turn with an open question, and your human is not " +
  "watching the terminal. Reach them on their phone now with the /call-me skill — " +
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

  // Scope. By default only sessions that actually opted into /call-me get a nudge:
  // the per-session state file is written by the MCP server / monitor on first
  // real use, so its existence is the same signal that scopes the monitor to
  // on-skill-invoke, and a session that never touched the skill stays silent.
  //
  // That default has an onboarding hole, though — a human who is usually away
  // wants the backstop in sessions that would never think to mention /call-me at
  // all. `callme remind on` sets always_remind for exactly that case.
  if (!alwaysRemind() && !optedInStateFile(sessionId, cwd)) return;

  // A phone must be paired — but resolved ONLY through the shared precedence
  // rules (env override -> config.json -> this session's own legacy file).
  // No scanning of other sessions. Ever.
  if (!isValidNumber(resolveUserNumber({ projectDir: cwd || undefined }).number)) return;

  const key = stampKey(sessionId, cwd);

  // An arm the MODEL made outranks everything below it. It called
  // wait_for_answer because it knows it parked a question and how long the
  // answer is worth waiting for; the pattern list further down is a guess about
  // the same thing. Without this the guess WINS and silently deletes the arm:
  // looksParked() is false for plenty of real parked questions, and the very
  // next branch clears the waiter.
  const armed = readWaiter(key);
  if (modelArmed(armed)) {
    if (waiterAlive(key) && !waiterLapsed(armed)) return;
    // Either nobody is timing the window or it already closed unheard, so the
    // explicit arm cannot deliver what it promised. Drop it and fall through to
    // the heuristic backstop rather than leaving a dead file behind.
    clearWaiter(key);
  }

  if (!looksParked(input.last_assistant_message)) {
    // This turn parked nothing, so a waiter armed by an earlier turn is stale —
    // its question has been answered or dropped. Every Stop re-decides.
    clearWaiter(key);
    return;
  }

  // The model already texted or called within this turn — nothing to remind.
  if (reachedOutRecently(sessionId, cwd)) return;

  if (debounced(key)) return;

  // Preferred path: give the human the grace window and let the waiter monitor
  // time it. Silent on purpose — the turn has to actually end for them to type.
  const grace = answerGraceSeconds();
  if (grace > 0 && process.env.CALLME_NO_ANSWER_WAIT !== "1" && waiterAlive(key)) {
    armWaiter(key, { question: parkedQuestion(input.last_assistant_message), graceS: grace });
    return;
  }

  // Nothing is timing a window (monitors off, unsupported, or the wait is
  // disabled), so fall back to handing the decision to the model right now.
  claimDebounce(key);
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

/**
 * Stamp key: per Claude session, falling back to the project. Shared with the
 * waiter monitor through lib/callme-config.mjs — if these two ever disagree the
 * hook arms a file nobody reads, so there is exactly one implementation.
 */
function stampKey(sessionId, cwd) {
  return stateKey({ sessionId, projectDir: cwd || undefined });
}

function reachedOutRecently(sessionId, cwd) {
  const at = parseJson(readFileQuiet(reachStampPath(stampKey(sessionId, cwd))))?.at;
  if (!Number.isFinite(at)) return false;
  return Date.now() - at < ALREADY_REACHED_WINDOW_S * 1000;
}

/**
 * One escalation per session per debounce window, so a barrage of
 * question-shaped turns produces a single nudge.
 *
 * Checking and claiming are separate because the two paths claim at different
 * moments: an instant reminder claims here, while an armed waiter is silent for
 * now and the monitor claims the same stamp only if the window actually closes
 * unanswered. Claiming at arm time would burn the window on a question the human
 * answered in five seconds.
 */
function debounced(key) {
  return stampFresh(hookStampPath("stop", key), DEBOUNCE_S);
}

function claimDebounce(key) {
  touchStamp(hookStampPath("stop", key));
}

/**
 * The one line worth quoting back when the model is woken minutes later: the
 * last question-shaped line of its own final message.
 */
function parkedQuestion(message) {
  const lines = String(message || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.reverse().find((line) => line.endsWith("?")) || lines.at(-1) || "";
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
