#!/usr/bin/env node

// Answer waiter — the second half of the outbound backstop.
//
// The Stop hook knows the exact instant a turn ends on a parked question, but it
// is the wrong party to act: the human is often right there and about to type, so
// ringing a phone at that instant is premature. So the hook only ARMS a waiter
// (~/.aiphone/claude-await-<key>.json) and lets the turn end. This process times
// the grace window that follows.
//
// If the window closes with no answer, it prints ONE line to stdout. Claude Code
// delivers a monitor's stdout line into the session as a notification, which
// re-invokes the model — and the model, which is the only party with the context
// to judge it, does the dialling with the /call-me skill. That keeps the standing
// rule of this repo intact: hooks remind, models dial. Nothing here ever touches
// the network.
//
// Why a long-lived monitor rather than a process the hook spawns: a hook's child
// has no way to inject anything into the session, and monitors are declared
// statically in monitors.json. So the monitor runs from session start and idles
// until armed — one stat() per tick.
//
// Disarming (i.e. "the human answered") happens outside this process: the
// UserPromptSubmit hook clears the arm file the moment they type, SessionEnd
// clears it when the session is over, and the next Stop clears it if that turn
// parked nothing.

import {
  clearWaiter,
  hookStampPath,
  modelArmed,
  reachStampPath,
  readJson,
  readWaiter,
  stateKey,
  touchStamp,
  waiterHeartbeatPath,
  waiterLapsed,
  writeJsonPrivate,
} from "../lib/callme-config.mjs";

const KEY = stateKey();
const TICK_MS = 2_000;
const HEARTBEAT_MS = 10_000;
// An arm file this much past its window belongs to a crashed or suspended
// session; waking the model to phone someone about a question from hours ago is
// worse than staying quiet.
const STALE_MS = 6 * 60 * 60 * 1_000;

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

let lastHeartbeat = 0;

while (!stopping) {
  try {
    heartbeat();
    tick();
  } catch (error) {
    // Never die: the hook falls back to an instant reminder only while the
    // heartbeat is stale, so a crash here would silently disable the wait.
    console.error(`/call-me answer waiter tick failed: ${error.message}`);
  }
  await delay(TICK_MS);
}

/**
 * The hook checks this before arming. A stale heartbeat means "no one is timing
 * the window", and the hook reminds immediately instead.
 */
function heartbeat() {
  const now = Date.now();
  if (now - lastHeartbeat < HEARTBEAT_MS) return;
  lastHeartbeat = now;
  writeJsonPrivate(waiterHeartbeatPath(KEY), { at: now, pid: process.pid });
}

function tick() {
  const armed = readWaiter(KEY);
  if (!armed) return;

  if (!waiterLapsed(armed)) return;

  const waitedMs = Date.now() - armed.armed_at;
  const graceMs = Math.max(0, Number(armed.grace_s) || 0) * 1_000;
  clearWaiter(KEY);
  if (waitedMs > graceMs + STALE_MS) return;

  // The model reached the human by itself after the arm — a text or a call
  // already went out for this very question, so there is nothing to escalate.
  if (reachedOutSince(armed.armed_at)) return;

  // Claim the shared Stop debounce so the hook does not re-arm on the turn this
  // notification is about to start.
  touchStamp(hookStampPath("stop", KEY));
  process.stdout.write(`${escalation(armed, waitedMs)}\n`);
}

function reachedOutSince(sinceMs) {
  const at = readJson(reachStampPath(KEY))?.at;
  return Number.isFinite(at) && at >= sinceMs;
}

function escalation(armed, waitedMs) {
  const minutes = Math.max(1, Math.round(waitedMs / 60_000));
  const asked = armed.question
    ? ` The open question was: "${armed.question}".`
    : "";
  // A window the model asked for is a promise being kept, not a guess being
  // acted on, so say so — it is the difference between "you asked to be woken"
  // and "something noticed a question in your last message".
  const why = modelArmed(armed)
    ? `The window you asked to wait has closed: no answer at the keyboard for ${minutes} min.`
    : `Your human has not answered at the keyboard for ${minutes} min, and your last turn ` +
      `ended on a question that is still open.`;
  return (
    `${why}${asked} They are away — reach them on their ` +
    `phone now with the /call-me skill: call if the answer is blocking or time-sensitive, ` +
    `text if it can wait. Do not ask again in the terminal; that is what they just missed. ` +
    `If the question no longer matters, say so in one line and stop.`
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A stale heartbeat is the hook's fallback signal, so leave nothing behind that
// claims a waiter is still watching this session.
process.on("exit", () => {
  try {
    writeJsonPrivate(waiterHeartbeatPath(KEY), { at: 0, pid: process.pid, stopped: true });
  } catch {}
});
