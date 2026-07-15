#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const api = (
  process.env.AIPHONE_API ||
  "https://serdaroztetik.com/aiphone"
).replace(/\/$/, "");
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const projectName = projectDir.split("/").filter(Boolean).at(-1) || "project";
const stateDir = process.env.AIPHONE_STATE_DIR || join(homedir(), ".aiphone");
// Same key derivation as channel.mjs: per Claude session when the host
// exposes CLAUDE_CODE_SESSION_ID (both processes get it), else per project.
const claudeSessionId = (process.env.CLAUDE_CODE_SESSION_ID || "").replace(/[^A-Za-z0-9-]/g, "");
const projectKey = projectDir.replace(/[^A-Za-z0-9]+/g, "-");
const stateKey = claudeSessionId || projectKey;
const sessionFile = join(
  stateDir,
  claudeSessionId ? `claude-session-${claudeSessionId}.json` : `claude-channel-${projectKey}.json`,
);
const cursorFile = join(stateDir, `claude-monitor-${stateKey}.json`);

// Monitor processes don't get the plugin's userConfig (only the MCP server's
// .mcp.json env supports ${user_config.*} interpolation), so fall back to the
// shared session file the channel server writes.
const userNumber = normalizeNumber(
  process.env.CLAUDE_PLUGIN_OPTION_user_number ||
  process.env.CLAUDE_PLUGIN_OPTION_USER_NUMBER ||
  process.env.AIPHONE_USER_NUMBER ||
  (await savedUserNumber()),
);

if (!/^\d{10}$/.test(userNumber)) {
  throw new Error("Call Me monitor needs the configured 10-digit user number");
}

async function savedUserNumber() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return JSON.parse(readFileSync(sessionFile, "utf8")).userNumber || "";
    } catch {
      // The channel MCP server may not have written the file yet.
    }
    await delay(200);
  }
  return "";
}

let session = await waitForSharedSession();
let cursor = restoreCursor(session.session_token);
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

while (!stopping) {
  try {
    const query = new URLSearchParams({
      session_token: session.session_token,
      cursor: String(cursor),
      wait: "50",
    });
    const response = await requestJson(`/sessions/events?${query}`, { timeoutMs: 60_000 });
    cursor = response.cursor;

    for (const event of response.events) {
      if (!isFromPairedUser(event)) continue;
      // Claude monitors deliver each stdout line as an inbound notification.
      // Keep the entire instruction on one line; diagnostics belong on stderr.
      process.stdout.write(`${notificationText(event)}\n`);
    }
    saveCursor();
  } catch (error) {
    console.error(`Call Me monitor poll failed: ${error.message}`);
    await delay(2_000);
    session = await waitForSharedSession();
  }
}

async function waitForSharedSession() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const saved = JSON.parse(readFileSync(sessionFile, "utf8"));
      if (
        saved.api === api &&
        saved.userNumber === userNumber &&
        saved.session?.session_token
      ) {
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
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    sessionFile,
    JSON.stringify({ api, userNumber, session: created, cursor: 0 }, null, 2),
  );
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
  try {
    const saved = JSON.parse(readFileSync(cursorFile, "utf8"));
    if (saved.sessionToken === sessionToken && Number.isInteger(saved.cursor)) {
      return saved.cursor;
    }
  } catch {
    // First run or a newly-created AI session starts at the beginning.
  }
  return 0;
}

function saveCursor() {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(cursorFile, JSON.stringify({ sessionToken: session.session_token, cursor }));
  } catch (error) {
    console.error(`Call Me monitor state save failed: ${error.message}`);
  }
}

function isFromPairedUser(event) {
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

function normalizeNumber(value) {
  return String(value).replace(/\D/g, "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
