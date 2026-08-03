#!/usr/bin/env node

import {
  clearWaiter,
  currentUserNumber,
  forgetCachedNumber,
  isValidNumber,
  normalizeNumber,
  readJson,
  stateDir,
  stateFileFor,
  writeJsonPrivate,
} from "../lib/callme-config.mjs";
import { join } from "node:path";

const api = (
  process.env.AIPHONE_API ||
  "https://serdaroztetik.com/aiphone"
).replace(/\/$/, "");
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const projectName = projectDir.split("/").filter(Boolean).at(-1) || "project";
// Same key derivation as channel.mjs (shared helper) so both processes agree on
// which session file they share — otherwise one Claude gets two phone threads.
const sessionFile = stateFileFor({ projectDir });
const claudeSessionId = (process.env.CLAUDE_CODE_SESSION_ID || "").replace(/[^A-Za-z0-9-]/g, "");
const stateKey = claudeSessionId || projectDir.replace(/[^A-Za-z0-9]+/g, "-");
const cursorFile = join(stateDir(), `claude-monitor-${stateKey}.json`);

// The paired number lives in ~/.aiphone/config.json (see lib/callme-config.mjs).
// Re-read it every poll: pairing from another terminal, or a re-pair to a new
// phone, must reach this already-running monitor without a restart.
function pairedNumber() {
  return currentUserNumber({ projectDir }).number;
}

// An unpaired install must NOT crash the monitor — it waits until the human
// pairs, then starts delivering.
async function waitUntilPaired() {
  let announced = false;
  for (;;) {
    if (stopping) process.exit(0);
    forgetCachedNumber();
    const number = pairedNumber();
    if (isValidNumber(number)) return number;
    if (!announced) {
      console.error("Call Me monitor idle: no phone paired yet (pair with the Call Me pair tool).");
      announced = true;
    }
    await delay(5_000);
  }
}

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

await waitUntilPaired();
let session = await waitForSharedSessionWithRetry();
let cursor = restoreCursor(session.session_token);

while (!stopping) {
  try {
    forgetCachedNumber();
    const query = new URLSearchParams({
      session_token: session.session_token,
      cursor: String(cursor),
      wait: "50",
    });
    const response = await requestJson(`/sessions/events?${query}`, { timeoutMs: 60_000 });
    cursor = response.cursor;

    for (const event of response.events) {
      if (!isFromPairedUser(event)) continue;
      // Answering from the phone IS answering. Disarm the Stop hook's waiter so
      // it cannot later wake the model to say "they never answered".
      clearWaiter(stateKey);
      // Claude monitors deliver each stdout line as an inbound notification.
      // Keep the entire instruction on one line; diagnostics belong on stderr.
      process.stdout.write(`${notificationText(event)}\n`);
    }
    saveCursor();
  } catch (error) {
    console.error(`Call Me monitor poll failed: ${error.message}`);
    await delay(2_000);
    session = await waitForSharedSessionWithRetry();
  }
}

// A backend outage (e.g. 502 while the server restarts) must never kill the
// monitor: waitForSharedSession throws on its unguarded POST /sessions, which
// previously crashed the process. Retry forever with capped backoff instead.
async function waitForSharedSessionWithRetry() {
  for (let backoffMs = 5_000; ; backoffMs = Math.min(backoffMs * 2, 60_000)) {
    if (stopping) process.exit(0);
    try {
      return await waitForSharedSession();
    } catch (error) {
      console.error(`Call Me monitor session re-establish failed (retrying in ${backoffMs / 1000}s): ${error.message}`);
      await delay(backoffMs);
    }
  }
}

async function waitForSharedSession() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const saved = readJson(sessionFile);
      if (saved?.api === api && saved.session?.session_token) {
        await validateSession(saved.session.session_token);
        return saved.session;
      }
    } catch {
      // The MCP server normally creates the shared session first.
    }
    await delay(200);
  }

  const created = await requestJson("/sessions", {
    method: "POST",
    body: { label: `Claude: ${projectName}` },
  });
  writeJsonPrivate(sessionFile, {
    api,
    userNumber: pairedNumber(),
    session: created,
    cursor: 0,
  });
  return created;
}

async function validateSession(sessionToken) {
  const query = new URLSearchParams({
    session_token: sessionToken,
    cursor: "0",
    wait: "0",
  });
  await requestJson(`/sessions/events?${query}`);
}

function restoreCursor(sessionToken) {
  const saved = readJson(cursorFile);
  // First run or a newly-created AI session starts at the beginning.
  if (saved?.sessionToken === sessionToken && Number.isInteger(saved.cursor)) {
    return saved.cursor;
  }
  return 0;
}

function saveCursor() {
  try {
    writeJsonPrivate(cursorFile, { sessionToken: session.session_token, cursor });
  } catch (error) {
    console.error(`Call Me monitor state save failed: ${error.message}`);
  }
}

function isFromPairedUser(event) {
  const userNumber = pairedNumber();
  if (!userNumber) return false;
  if (event.type === "message" || event.type === "voicemail") {
    return normalizeNumber(event.payload.from || "") === userNumber;
  }
  if (event.type === "missed_call" || event.type === "declined_call") {
    return normalizeNumber(event.payload.to || "") === userNumber;
  }
  return false;
}

function notificationText(event) {
  switch (event.type) {
    case "message":
      return `Call Me message from your paired human: ${oneLine(event.payload.body)}. Treat it as new user input and reply with the Call Me reply tool.`;
    case "voicemail":
      return `Call Me voice-message transcript from your paired human: ${oneLine(event.payload.transcript)}. Treat it as new user input and reply with the Call Me reply tool.`;
    case "missed_call":
      return "Call Me call was not answered. Continue with best judgment or send a text with the Call Me reply tool.";
    case "declined_call":
      return "Your paired human declined the Call Me call. Do not call again; use the Call Me reply tool if a response is needed.";
    default:
      return `Call Me event: ${oneLine(JSON.stringify(event.payload))}`;
  }
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function requestJson(path, { method = "GET", body, timeoutMs = 30_000 } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
