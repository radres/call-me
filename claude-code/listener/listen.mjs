#!/usr/bin/env node

// The idle listener: a background Stop/SessionStart hook (asyncRewake) that
// waits for the human to text or call this session from the /call-me app, and
// wakes the session when they do.
//
// Why it exists: an agent reaches the phone with no setup, but the other
// direction only works while something on this side asks the server for new
// events. The inbox monitor does that, but only after the call-me skill was
// invoked in this session, and only that session; a session that merely texted
// the human once left a thread on their phone that nobody read. On 2026-11-04
// 51 texts and voice messages from 21 people had gone unanswered that way.
//
// How it wakes anything: Claude Code runs an `asyncRewake` hook in the
// background, and when it exits 2 its stderr reaches the model as a system
// reminder, waking an idle session (verified on 2.1.316). It is started again
// on every Stop, so a session listens whenever it is not working.
//
// Rules, each one load-bearing:
//   - It only ever READS (GET /sessions/events). Like the hooks, it never dials
//     and never texts: `grep -E "POST|/calls|/ring|/text" listener/` stays empty.
//   - Only a session that already has a /call-me thread listens: no session file
//     means no thread on any phone, so there is nothing to hear.
//   - Only a text or a voice message from the paired human wakes it
//     (isFromPairedUser, the filter the monitor and the channel pump use).
//   - One listener per session, and the NEWEST wins: a fresh hook stops the old
//     one, because the harness is sure to be tracking the one it just started.
//   - It steps aside while the channel pump or the inbox monitor is delivering,
//     so a message never reaches the model twice. Both heartbeat; this re-checks.
//   - It leaves before the harness's hook timeout and when its parent is gone.
//
// Opt out with CALLME_NO_LISTEN=1, or `"listen": false` in ~/.aiphone/config.json.

import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  channelClaimed,
  clearWaiter,
  forgetCachedNumber,
  hookSessionKey,
  inboundCursorPath,
  isValidNumber,
  listenerLockPath,
  monitorAlive,
  readConfig,
  readJson,
  resolveUserNumber,
  stateDir,
  stateFileFor,
  stateKey,
  writeJsonPrivate,
} from "../lib/callme-config.mjs";
import { isFromPairedUser, notificationText } from "../lib/inbound-events.mjs";

const DEFAULT_API = "https://callmemcp.com/aiphone";
// hooks.json gives this hook 86400 s; leave well before the harness kills it.
const MAX_RUN_S = numberFromEnv("CALLME_LISTEN_MAX_S", 86_400 - 600);
const POLL_WAIT_S = numberFromEnv("CALLME_LISTEN_WAIT_S", 50);
const DEFER_CHECK_MS = numberFromEnv("CALLME_LISTEN_DEFER_MS", 10_000);
const WAKE = 2;
const HUMAN_SENT = new Set(["message", "voicemail"]);

let stopping = false;
process.on("SIGTERM", () => { stopping = true; process.exit(0); });
process.on("SIGINT", () => { stopping = true; process.exit(0); });

main().catch(() => process.exit(0));

async function main() {
  const input = parseJson(await readStdin()) || {};
  if (process.env.CALLME_NO_LISTEN === "1" || readConfig()?.listen === false) return;

  const projectDir = typeof input.cwd === "string" ? input.cwd : undefined;
  const sessionId = hookSessionKey(input.session_id);
  const key = stateKey({ sessionId, projectDir });
  const lock = listenerLockPath(key);

  if (input.hook_event_name === "SessionEnd") {
    stopOwner(lock);
    return;
  }

  const sessionFile = sessionFileFor(sessionId, projectDir);
  const saved = readJson(sessionFile);
  const token = saved?.session?.session_token;
  if (!token) return;
  const api = (process.env.AIPHONE_API || saved.api || DEFAULT_API).replace(/\/$/, "");

  stopOwner(lock);
  writeJsonPrivate(lock, { pid: process.pid, started_at: new Date().toISOString() });
  const release = () => {
    if (readJson(lock)?.pid === process.pid) {
      try { unlinkSync(lock); } catch {}
    }
  };
  process.on("exit", release);

  // The hook runs as `sh -c node …` under claude, so watch both: either one
  // gone means the session is over (a crash skips SessionEnd).
  const watched = [process.ppid, parentOf(process.ppid)].filter((pid) => pid > 1);
  const deadline = Date.now() + MAX_RUN_S * 1000;
  const cursorFile = inboundCursorPath(key);

  while (!stopping && Date.now() < deadline) {
    if (!stillOwner(lock) || !watched.every(alive)) return;

    forgetCachedNumber();
    const number = resolveUserNumber({ projectDir }).number;
    if (!isValidNumber(number)) {
      await delay(DEFER_CHECK_MS);
      continue;
    }
    // Someone else is delivering this session's events. Wait, and take over
    // if they stop.
    if (channelClaimed(key) || monitorAlive(key)) {
      await delay(DEFER_CHECK_MS);
      continue;
    }

    let response;
    const cursor = restoreCursor(cursorFile, token);
    try {
      const wait = Math.max(0, Math.min(POLL_WAIT_S, Math.floor((deadline - Date.now()) / 1000)));
      response = await getJson(
        `${api}/sessions/events?${new URLSearchParams({
          session_token: token,
          cursor: String(cursor),
          wait: String(wait),
        })}`,
        (wait + 15) * 1000,
      );
    } catch (error) {
      // A 401 means the session is gone (deleted number, revoked token):
      // nothing will ever arrive, so stop asking.
      if (error.status === 401 || error.status === 404) return;
      await delay(5_000);
      continue;
    }

    if (!stillOwner(lock)) return;
    // The monitor or the pump may have started during that poll. Leave the
    // cursor where it was so they deliver these events, not us.
    if (channelClaimed(key) || monitorAlive(key)) continue;

    const events = Array.isArray(response?.events) ? response.events : [];
    const next = Number.isInteger(response?.cursor) ? response.cursor : cursor;
    const lines = [];
    for (const event of events) {
      // Only what the human sent. A missed or declined call is this agent's
      // own call coming back; the call tool already reported it, and waking an
      // idle session for it invites a ring-again loop.
      if (!HUMAN_SENT.has(event.type) || !isFromPairedUser(event, number)) continue;
      lines.push(notificationText(event));
    }
    saveCursor(cursorFile, token, next);
    if (lines.length) {
      clearWaiter(key);
      process.stderr.write(`${lines.join("\n")}\n`);
      process.exit(WAKE);
    }
    if (POLL_WAIT_S === 0) await delay(1_000);
  }
}

/** Same file channel.mjs and the monitor use for this session's thread. */
function sessionFileFor(sessionId, projectDir) {
  const id = String(sessionId || "").replace(/[^A-Za-z0-9-]/g, "");
  if (id) {
    const file = join(stateDir(), `claude-session-${id}.json`);
    if (existsSync(file)) return file;
  }
  return stateFileFor({ projectDir });
}

function restoreCursor(file, token) {
  const saved = readJson(file);
  return saved?.sessionToken === token && Number.isInteger(saved.cursor) ? saved.cursor : 0;
}

function saveCursor(file, token, cursor) {
  try {
    writeJsonPrivate(file, { sessionToken: token, cursor });
  } catch {}
}

function stopOwner(lock) {
  const pid = readJson(lock)?.pid;
  if (Number.isInteger(pid) && pid !== process.pid && alive(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
}

function stillOwner(lock) {
  return readJson(lock)?.pid === process.pid;
}

function parentOf(pid) {
  try {
    return Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim()) || 0;
  } catch {
    return 0;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function getJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { "x-callme-client": "claude-code-listener" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`GET returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    const done = setTimeout(() => resolve(data), 2_000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => { clearTimeout(done); resolve(data); });
    process.stdin.on("error", () => { clearTimeout(done); resolve(data); });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
