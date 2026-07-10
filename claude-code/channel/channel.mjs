#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const api = (process.env.AIPHONE_API || "https://serdaroztetik.com/aiphone").replace(/\/$/, "");
const userNumber = normalizeNumber(process.env.AIPHONE_USER_NUMBER || "");
const projectName = process.cwd().split("/").filter(Boolean).at(-1) || "project";

if (!/^\d{10}$/.test(userNumber)) {
  throw new Error("AIPHONE_USER_NUMBER must be the 10-digit number shown in the iPhone app");
}

// One AI Phone session per Claude session: each plugin-enabled Claude gets its
// own number/thread on the phone, so several Claudes can run in one project
// without racing on shared state. Falls back to per-project state on hosts
// that don't expose CLAUDE_CODE_SESSION_ID.
const claudeSessionId = (process.env.CLAUDE_CODE_SESSION_ID || "").replace(/[^A-Za-z0-9-]/g, "");
const stateDir = process.env.AIPHONE_STATE_DIR || join(homedir(), ".aiphone");
const stateFile = join(
  stateDir,
  claudeSessionId
    ? `claude-session-${claudeSessionId}.json`
    : `claude-channel-${process.cwd().replace(/[^A-Za-z0-9]+/g, "-")}.json`,
);

const { session } = await restoreOrCreateSession();

const mcp = new Server(
  { name: "aiphone", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
    },
    instructions:
      "Messages from the paired human arrive as aiphone-inbox monitor notifications. " +
      "Treat them as user messages for this session. Use the reply tool for conversational replies, " +
      "text for one-way updates, and call only when a spoken answer is genuinely needed. " +
      "The phone shows this session as a conversation thread; once the topic is clear (and when it " +
      "shifts), call set_title with a short 3-5 word title so the human can tell threads apart.",
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Reply by text to the paired human in the AI Phone conversation",
      inputSchema: textSchema("Reply text"),
    },
    {
      name: "text",
      description: "Send a non-blocking text update to the paired human's iPhone",
      inputSchema: textSchema("Text to send"),
    },
    {
      name: "call",
      description: "Call the paired human, speak a question, and wait for the transcribed answer",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", minLength: 1, maxLength: 600 },
          timeout_seconds: { type: "integer", minimum: 30, maximum: 900, default: 300 },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
    {
      name: "identity",
      description: "Show this Claude session's AI Phone routing number and label",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "set_title",
      description:
        "Set this session's thread title on the human's phone (3-5 words describing the conversation)",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string", minLength: 1, maxLength: 80 } },
        required: ["title"],
        additionalProperties: false,
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments || {};
  switch (request.params.name) {
    case "reply":
    case "text":
      await sendText(String(args.text || ""));
      return toolResult("sent");
    case "call": {
      const result = await requestJson("/calls", {
        method: "POST",
        body: {
          session_token: session.session_token,
          to: userNumber,
          text: String(args.question || ""),
          timeout_s: Number(args.timeout_seconds || 300),
        },
        timeoutMs: (Number(args.timeout_seconds || 300) + 30) * 1000,
      });
      return toolResult(JSON.stringify(result));
    }
    case "identity":
      return toolResult(JSON.stringify({
        session_number: session.session_number,
        display: session.display,
        label: `Claude: ${projectName}`,
      }));
    case "set_title": {
      const label = String(args.title || "").trim();
      await requestJson("/sessions/label", {
        method: "POST",
        body: { session_token: session.session_token, label },
      });
      return toolResult(`titled: ${label}`);
    }
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

// Inbound events are consumed by monitors/inbound.mjs (Claude monitor), which
// shares this process's persisted session. Channel notifications are blocked
// by the channels allowlist even with the development bypass flags, so this
// server only provides tools and the shared session.
await mcp.connect(new StdioServerTransport());

async function sendText(text) {
  if (!text.trim()) throw new Error("text must not be empty");
  await requestJson("/messages", {
    method: "POST",
    body: { session_token: session.session_token, to: userNumber, body: text },
  });
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

function textSchema(description) {
  return {
    type: "object",
    properties: { text: { type: "string", description, minLength: 1 } },
    required: ["text"],
    additionalProperties: false,
  };
}

function toolResult(text) {
  return { content: [{ type: "text", text }] };
}

async function restoreOrCreateSession() {
  try {
    const saved = JSON.parse(readFileSync(stateFile, "utf8"));
    if (saved.api === api && saved.userNumber === userNumber && saved.session?.session_token) {
      const query = new URLSearchParams({
        session_token: saved.session.session_token,
        cursor: String(saved.cursor || 0),
        wait: "0",
      });
      await requestJson(`/sessions/events?${query}`);
      return { session: saved.session, cursor: saved.cursor || 0 };
    }
  } catch {
    // missing/corrupt state or dead session: fall through and create a new one
  }
  const session = await requestJson("/sessions", {
    method: "POST",
    body: { label: `Claude: ${projectName}` },
  });
  const state = { session, cursor: 0 };
  saveStateObject(state);
  return state;
}

function saveStateObject(state) {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ api, userNumber, ...state }, null, 2));
  } catch (error) {
    console.error(`AI Phone state save failed: ${error.message}`);
  }
}

function normalizeNumber(value) {
  return String(value).replace(/\D/g, "");
}
