#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  NOT_PAIRED_HINT,
  currentUserNumber,
  displayNumber,
  forgetCachedNumber,
  hardenModes,
  isValidNumber,
  markReachedOut,
  normalizeNumber,
  pruneStaleState,
  readJson,
  stateFileFor,
  writeConfig,
  writeJsonPrivate,
} from "../lib/callme-config.mjs";
import { APP_STORE_URL } from "../lib/appstore-qr.mjs";

const api = (process.env.AIPHONE_API || "https://serdaroztetik.com/aiphone").replace(/\/$/, "");
const projectName = process.cwd().split("/").filter(Boolean).at(-1) || "project";

// Bump whenever the onboarding copy below changes. dist/channel.mjs is an esbuild
// bundle of this file and is what .mcp.json actually runs, so a stale bundle ships
// old wording that looks fixed in source. scripts/check-copy-sync.sh greps both for
// this literal — mtimes cannot be used, `rsync -a` preserves them.
const SETUP_COPY_REV = "2026-07-30";

// Shorter than the 300s default for a deliberate call: pairing rings a phone that
// may be in a drawer, and blocking the agent for five minutes to learn that is a
// bad trade. 90s is long enough to pick up, short enough to fall back to a text.
const PAIR_CALL_TIMEOUT_S = 90;

// One Call Me session per Claude session: each plugin-enabled Claude gets its
// own number/thread on the phone, so several Claudes can run in one project
// without racing on shared state. Falls back to per-project state on hosts
// that don't expose CLAUDE_CODE_SESSION_ID.
const stateFile = stateFileFor();
// Same key the Stop hook derives from its payload's session_id, so the "already
// reached out this turn" stamp written here is the one that hook reads.
const stateKey =
  (process.env.CLAUDE_CODE_SESSION_ID || "").replace(/[^A-Za-z0-9-]/g, "") ||
  (process.env.CLAUDE_PROJECT_DIR || process.cwd()).replace(/[^A-Za-z0-9]+/g, "-");

// Housekeeping on start: tighten modes on the state dir (old versions wrote
// 0644 token files) and drop session state nobody will ever read again.
hardenModes();
pruneStaleState();

// The number is resolved lazily, per send — pairing from another terminal must
// reach an already-running session — and an unpaired install must still boot so
// the setup tool can onboard the human.
function pairedNumber() {
  return currentUserNumber().number;
}

const mcp = new Server(
  { name: "callme", version: "0.5.1" },
  {
    capabilities: {
      tools: {},
    },
    instructions:
      "Reach out BEFORE you end a turn on an open question: once the turn ends you are asleep and " +
      "cannot contact anyone, so a question left in your final message never gets asked. Text first, " +
      "call when it is blocking or time-sensitive. " +
      "Messages from the paired human arrive as callme-inbox monitor notifications. " +
      "Treat them as user messages for this session. Use the reply tool for conversational replies, " +
      "text for one-way updates, and call only when a spoken answer is genuinely needed. " +
      "The phone shows this session as a conversation thread; once the topic is clear (and when it " +
      "shifts), call set_title with a short 3-5 word title so the human can tell threads apart. " +
      "If a send reports that no phone is paired, run the setup tool and show the human its output " +
      "verbatim, then pair the number they read back — never guess a number. " +
      "pair RINGS their phone to prove the loop, so tell them in one line that it is about to ring " +
      "before you call pair; it blocks until they answer or it times out.",
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Reply by text to the paired human in the Call Me conversation",
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
      name: "setup",
      description:
        "Onboarding instructions to show a human who has not set up Call Me yet " +
        "(App Store link + how to read their number back). Use this instead of guessing a number.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "pair",
      description:
        "Remember the 10-digit Call Me number the human read out of the app, then RING that phone " +
        "to prove the loop works and return what they say. Tell them their phone is about to ring " +
        "before you call this — it blocks for up to 90s and falls back to a text if nobody answers. " +
        "Every Claude session on this machine then reaches the same phone.",
      inputSchema: {
        type: "object",
        properties: { number: { type: "string", description: "10-digit number from the app" } },
        required: ["number"],
        additionalProperties: false,
      },
    },
    {
      name: "identity",
      description: "Show this Claude session's Call Me routing number and the paired phone",
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
    case "text": {
      const to = pairedNumber();
      if (!to) return notPaired();
      const { delivered, notice } = await sendText(to, String(args.text || ""));
      if (delivered) return toolResult("sent");
      return toolResult(
        `sent, but NOT shown on their phone. ${notice} Do not repeat the text ` +
          "expecting a different result — use call if you need them now.",
      );
    }
    case "call": {
      const to = pairedNumber();
      if (!to) return notPaired();
      const result = await placeCall(to, String(args.question || ""), Number(args.timeout_seconds || 300));
      return toolResult(JSON.stringify(result));
    }
    case "setup":
      return toolResult(setupText());
    case "pair": {
      const number = normalizeNumber(args.number);
      if (!isValidNumber(number)) {
        return toolResult(
          `"${args.number}" is not a 10-digit Call Me number. Ask the human to read it off the ` +
            "app's home screen again — do not guess.",
          true,
        );
      }
      writeConfig({ user_number: number, source: "mcp-pair" });
      forgetCachedNumber();

      // Ring rather than text: one answered call proves push delivery, CallKit,
      // two-way audio and transcription at once, and it is the moment the
      // product sells itself. The text is only the fallback.
      const shared = `Every Call Me session on this machine now uses ${displayNumber(number)}.`;
      try {
        const result = await placeCall(
          number,
          "You're paired with your AI assistant. Say anything back so I know I can hear you.",
          PAIR_CALL_TIMEOUT_S,
        );
        if (result?.status === "completed") {
          return toolResult(
            `Paired with ${displayNumber(number)} and confirmed by voice. They said: ` +
              `"${result.transcript || ""}". ${shared}`,
          );
        }
        // Missed, declined or timed out — fall back to a text. Never redial.
        const fallback = await sendText(
          number,
          "Paired ✅ — this Claude session can now text and call you.",
        );
        if (!fallback.delivered) {
          return toolResult(
            `Paired with ${displayNumber(number)}, but neither channel reached them: the ` +
              `confirmation call was ${result?.status || "unanswered"} and the fallback text was ` +
              `not shown. ${fallback.notice} ${shared}`,
          );
        }
        return toolResult(
          `Paired with ${displayNumber(number)}. The confirmation call was ${result?.status || "unanswered"}, ` +
            `so a text was sent instead — ask whether it arrived. If it did not, the number is wrong: ` +
            `re-pair with the right one rather than retrying. ${shared}`,
        );
      } catch (error) {
        try {
          await sendText(number, "Paired ✅ — this Claude session can now text and call you.");
          return toolResult(
            `Paired with ${displayNumber(number)}. The confirmation call failed (${error.message}), ` +
              `so a text was sent instead — ask whether it arrived. ${shared}`,
          );
        } catch (textError) {
          return toolResult(
            `Stored ${displayNumber(number)}, but NOTHING reached the phone — neither the call ` +
              `(${error.message}) nor a text (${textError.message}). The number is probably wrong; ` +
              "ask them to read it off the app's home screen again. Do not report setup as finished.",
            true,
          );
        }
      }
    }
    case "identity": {
      const session = await ensureSession();
      const paired = currentUserNumber();
      return toolResult(JSON.stringify({
        session_number: session.session_number,
        display: session.display,
        label: `Claude: ${projectName}`,
        paired_phone: paired.number ? displayNumber(paired.number) : null,
        paired_source: paired.source,
        // Also keeps SETUP_COPY_REV referenced so esbuild cannot tree-shake the
        // literal out of dist/channel.mjs, which is what the sync check greps.
        setup_copy_rev: SETUP_COPY_REV,
      }));
    }
    case "set_title": {
      const label = String(args.title || "").trim();
      const session = await ensureSession();
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

function setupText() {
  const cli = process.env.CALLME_PLUGIN_ROOT
    ? `${process.env.CALLME_PLUGIN_ROOT}/skills/call-me/callme`
    : "callme";
  const paired = currentUserNumber();
  return [
    "Show these steps to the human as-is:",
    "",
    '1. Install "Call Me" (free) on your iPhone:',
    `     ${APP_STORE_URL}`,
    "2. Open it and tap Agree & Continue — the app shows your 10-digit number.",
    "3. Read that number back to me.",
    "",
    "Then call the pair tool with those 10 digits — tell them first that their phone is about to",
    "ring, because pairing RINGS it and waits for them to speak. That answer is the proof the whole",
    "loop works; if nobody picks up it falls back to a text. After that I can text you and ring your",
    "phone, and your replies come straight back into this session.",
    "",
    "--- FOR YOU, THE AGENT: finish the job, don't stop at pairing ---",
    "",
    "Pairing only makes you ABLE to reach them. Do these too, now, or you will be",
    "able to call and still never actually do it in a later session:",
    "",
    "A. Ask them: \"How often are you away from the keyboard while I work —",
    "   rarely, sometimes, or usually?\"",
    "",
    "B. If they said sometimes or usually, turn on the standing reminder:",
    `       ${cli} remind on`,
    "   Without it the Stop hook only nudges sessions that already used Call Me,",
    "   so a session that never thinks to mention it stays silent — which is",
    "   exactly the session where they miss you asking.",
    "",
    "C. Append a \"## Reaching me\" rule to their ~/.claude/CLAUDE.md (read it",
    "   first, never overwrite): contact them instead of ending a turn with the",
    "   question in your final message — or parking it in an interactive question",
    "   widget, which waits silently and no hook can see; text first, call when blocking; never",
    `   hardcode the number (\`${cli} number\` reads it). Match the tone to their`,
    "   answer from A — \"mostly AFK, always reach out\" vs \"only if I'll be gone\".",
    "",
    "D. Verify, don't assume. If the pairing call was answered you are done — that",
    "   transcript IS the proof. Only if it went unanswered: send a text and ask",
    "   whether it arrived. If nothing lands either way the number is wrong —",
    "   re-pair rather than retrying.",
    "",
    `E. Tell them how to undo or tune it: \`${cli} remind off\`, \`${cli} grace 300\``,
    "   to be left alone at the keyboard longer before the phone gets involved",
    "   (0 = the moment a turn ends), and blocking a thread in the app mutes it.",
    paired.number ? `\nAlready paired with ${displayNumber(paired.number)} — pair again only to change phones.` : "",
  ]
    .join("\n")
    .trimEnd();
}

function notPaired() {
  return toolResult(`${NOT_PAIRED_HINT}\n\n${setupText()}`, true);
}

// Both the `call` tool and the pairing confirmation ring the phone the same way,
// so the request lives here once — two copies would drift.
async function placeCall(to, question, timeoutS) {
  const session = await ensureSession();
  const result = await requestJson("/calls", {
    method: "POST",
    body: { session_token: session.session_token, to, text: question, timeout_s: timeoutS },
    timeoutMs: (timeoutS + 30) * 1000,
  });
  markReachedOut(stateKey, "call");
  return result;
}

// Returns the server's verdict, which is NOT just "did the request work": a
// phone with notifications off keeps accepting texts that it never shows, so
// `delivered:false` means the human has not been reached and the caller has to
// know. Older servers omit the field; treat that as delivered rather than
// crying wolf on every send.
async function sendText(to, text) {
  if (!text.trim()) throw new Error("text must not be empty");
  const session = await ensureSession();
  const result = await requestJson("/messages", {
    method: "POST",
    body: { session_token: session.session_token, to, body: text },
  });
  markReachedOut(stateKey, "text");
  return { delivered: result?.delivered !== false, notice: result?.notice || "" };
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

function toolResult(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

// Memoized: created on first use rather than at startup, so a backend blip at
// boot no longer kills the MCP server before it can serve the setup tool.
let sessionPromise = null;

function ensureSession() {
  if (!sessionPromise) {
    sessionPromise = restoreOrCreateSession().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

async function restoreOrCreateSession() {
  const saved = readJson(stateFile);
  // Deliberately NOT comparing the paired number: a re-pair is the same human,
  // so the existing thread is refreshed in place instead of minting a new one.
  if (saved?.api === api && saved.session?.session_token) {
    try {
      const query = new URLSearchParams({
        session_token: saved.session.session_token,
        cursor: String(saved.cursor || 0),
        wait: "0",
      });
      await requestJson(`/sessions/events?${query}`);
      saveStateObject({ session: saved.session, cursor: saved.cursor || 0 });
      return saved.session;
    } catch {
      // dead session: fall through and create a new one
    }
  }
  const session = await requestJson("/sessions", {
    method: "POST",
    body: { label: `Claude: ${projectName}` },
  });
  saveStateObject({ session, cursor: 0 });
  return session;
}

function saveStateObject(state) {
  try {
    writeJsonPrivate(stateFile, { api, userNumber: pairedNumber(), ...state });
  } catch (error) {
    console.error(`Call Me state save failed: ${error.message}`);
  }
}
