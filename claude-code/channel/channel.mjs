#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  MODEL_WAIT_MAX_S,
  MODEL_WAIT_MIN_S,
  NOT_PAIRED_HINT,
  armWaiter,
  channelPushEnabled,
  claimChannel,
  clampModelWait,
  clearWaiter,
  currentUserNumber,
  displayNumber,
  forgetCachedNumber,
  hardenModes,
  inboundCursorPath,
  isValidNumber,
  markReachedOut,
  normalizeNumber,
  pruneStaleState,
  readJson,
  releaseChannel,
  stateFileFor,
  waiterAlive,
  writeConfig,
  writeJsonPrivate,
} from "../lib/callme-config.mjs";
import { eventMeta, isFromPairedUser, notificationText } from "../lib/inbound-events.mjs";
import { APP_STORE_URL } from "../lib/appstore-qr.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const api = (process.env.AIPHONE_API || "https://serdaroztetik.com/aiphone").replace(/\/$/, "");
const projectName = process.cwd().split("/").filter(Boolean).at(-1) || "project";

// Bump whenever the onboarding copy below changes. dist/channel.mjs is an esbuild
// bundle of this file and is what .mcp.json actually runs, so a stale bundle ships
// old wording that looks fixed in source. scripts/check-copy-sync.sh greps both for
// this literal — mtimes cannot be used, `rsync -a` preserves them.
const SETUP_COPY_REV = "2026-08-09";

// Shorter than the 300s default for a deliberate call: pairing rings a phone that
// may be in a drawer, and blocking the agent for five minutes to learn that is a
// bad trade. 90s is long enough to pick up, short enough to fall back to a text.
const PAIR_CALL_TIMEOUT_S = 90;

// One /call-me session per Claude session: each plugin-enabled Claude gets its
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

// The name Claude Code knows this server by, which is the exact string the
// channel gate matches against the session's --channels list. Plugin-provided
// MCP servers are registered as `plugin:<plugin>:<serverKey>`, hence the default.
//
// Overridable because the same file can also run as a plain user-scoped MCP
// server, where the name is whatever `claude mcp add` was given. Getting this
// wrong is silent (the gate just never matches), so `callme channel status`
// prints the entry this process expects rather than making anyone guess.
const MCP_SERVER_NAME = process.env.CALLME_MCP_SERVER_NAME || "plugin:call-me:callme";
const CHANNELS_ENTRY = `server:${MCP_SERVER_NAME}`;

// Inbound-only mode: declare the channel, run the pump, register NO tools.
//
// For hosts where the plugin's own server cannot be channel-registered, this
// file can be added as a second, plain MCP server purely to carry inbound push.
// It must not also expose call/text/reply there — two servers offering the same
// tools is how a model ends up texting the human twice.
const CHANNEL_ONLY = process.env.CALLME_CHANNEL_ONLY === "1";

const mcp = new Server(
  { name: "callme", version: "0.7.0" },
  {
    capabilities: {
      tools: {},
      // Unlocks `notifications/claude/channel`: this server may push inbound
      // messages into the live session instead of being polled. Declaring it is
      // necessary but not sufficient — see channelActive() for the rest of the
      // gate. Harmless on hosts that don't implement channels.
      experimental: { "claude/channel": {} },
    },
    // In channel-only mode the plugin's own server is already carrying the full
    // instructions; repeating them here would put two copies in the model's
    // context. Say only what is true of THIS server: it delivers inbound.
    instructions: CHANNEL_ONLY
      ? "Messages from the paired human arrive as /call-me channel messages. Treat them as user " +
        "messages for this session and answer them; use the /call-me reply tool to respond by text."
      : "Reach out BEFORE you end a turn on an open question: once the turn ends you are asleep and " +
      "cannot contact anyone, so a question left in your final message never gets asked. Text first, " +
      "call when it is blocking or time-sensitive. " +
      "If the human might simply be at the keyboard, call wait_for_answer instead of ringing them " +
      "straight away: it gives them a window you choose to answer here, and wakes you to phone them " +
      "only if they stay silent. Call it, then end your turn — do not keep the turn alive waiting. " +
      "Messages from the paired human arrive as inbound notifications or /call-me channel messages. " +
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
  tools: CHANNEL_ONLY ? [] : [
    {
      name: "reply",
      description: "Reply by text to the paired human in the /call-me conversation",
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
      name: "wait_for_answer",
      description:
        "End a turn on a question WITHOUT losing it: start a grace period for the human to answer in " +
        "the terminal, and if they stay silent you are woken up to phone them. You choose the wait. " +
        "Use it whenever you are about to park a question and they may be away — it costs nothing if " +
        "they are right there, because typing anything cancels it. Call it, then end your turn.",
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            minLength: 1,
            maxLength: 400,
            description: "The question you are waiting on, quoted back to you if you get woken",
          },
          seconds: {
            type: "integer",
            minimum: MODEL_WAIT_MIN_S,
            maximum: MODEL_WAIT_MAX_S,
            description:
              "How long to let them answer at the keyboard first. Short (60-120s) when they are " +
              "probably around, long (600s+) for an overnight or unattended run.",
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
    {
      name: "setup",
      description:
        "Onboarding instructions to show a human who has not set up /call-me yet " +
        "(App Store link + how to read their number back). Use this instead of guessing a number.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "pair",
      description:
        "Remember the 10-digit /call-me number the human read out of the app, then RING that phone " +
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
      description: "Show this Claude session's /call-me routing number and the paired phone",
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
    case "wait_for_answer": {
      // Deliberately requires a paired phone: the whole promise of the window is
      // "you will be woken to CALL them", and there is nobody to call otherwise.
      const to = pairedNumber();
      if (!to) return notPaired();

      const question = String(args.question || "").trim();
      if (!question) {
        return toolResult("Pass the question you are waiting on, so it can be quoted back to you.", true);
      }
      const seconds = clampModelWait(args.seconds);
      armWaiter(stateKey, { question, graceS: seconds, armedBy: "model" });

      // Truthful about the one case where this silently does nothing: the wait is
      // timed by the callme-answer-waiter monitor, and on a host with monitors
      // off or still starting, nothing will ever wake you.
      if (!waiterAlive(stateKey)) {
        return toolResult(
          `Armed a ${seconds}s window, but no /call-me waiter monitor is running in this session, so ` +
            "NOTHING will time it and you will not be woken. If the answer matters, text or call them " +
            "now instead of ending your turn on the question.",
        );
      }
      return toolResult(
        `Waiting ${seconds}s for them to answer here. End your turn now — that silence is what gives ` +
          "them the chance to type. If they answer, this is dropped automatically; if they stay quiet, " +
          "you will be woken to reach them by phone.",
      );
    }
    case "setup":
      return toolResult(setupText());
    case "pair": {
      const number = normalizeNumber(args.number);
      if (!isValidNumber(number)) {
        return toolResult(
          `"${args.number}" is not a 10-digit /call-me number. Ask the human to read it off the ` +
            "app's home screen again — do not guess.",
          true,
        );
      }
      writeConfig({ user_number: number, source: "mcp-pair" });
      forgetCachedNumber();

      // Ring rather than text: one answered call proves push delivery, CallKit,
      // two-way audio and transcription at once, and it is the moment the
      // product sells itself. The text is only the fallback.
      const shared = `Every /call-me session on this machine now uses ${displayNumber(number)}.`;
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

await mcp.connect(new StdioServerTransport());

// Inbound events reach the model one of two ways. This server pushes them over
// the MCP channel when it can; otherwise monitors/inbound.mjs prints them and
// this pump never starts. startChannelPump() is what decides, and it decides
// conservatively — see channelActive().
startChannelPump();

// --- inbound push over the MCP channel --------------------------------------

/**
 * Can this session actually receive `notifications/claude/channel`?
 *
 * The host gate has several conditions we cannot see from out here (feature
 * flag, provider, protocol era, org `channelsEnabled`), and a notification that
 * fails the gate is dropped SILENTLY — no error, no reply, nothing to catch. So
 * a pump that guessed wrong would take delivery away from the monitor and drop
 * every message into a void.
 *
 * The one condition that is both decisive and visible is the per-session
 * --channels allowlist: it is never on by default, so its presence in the parent
 * claude process's argv means somebody deliberately turned this on. Requiring it
 * makes the failure mode "monitor keeps working" instead of "inbound silently
 * stops", which is the only acceptable direction for this trade.
 */
function channelActive() {
  if (!channelPushEnabled()) return false;
  return parentArgvHasChannelsEntry();
}

/**
 * Read the launching claude process's argv and look for our --channels entry.
 *
 * /proc is exact where it exists; `ps -o command=` is the macOS fallback and
 * prints the full command line (not the truncated form `ps` shows by default).
 * Any failure returns false — an unreadable parent is treated as "not enabled".
 */
function parentArgvHasChannelsEntry() {
  const argv = readParentArgv();
  if (!argv) return false;
  // Match the tagged entry only. A bare mention of the server name elsewhere in
  // the command line (a --plugin-dir path, say) must not count as opt-in.
  return argv.includes(CHANNELS_ENTRY);
}

function readParentArgv() {
  const ppid = process.ppid;
  if (!ppid) return null;
  try {
    // Linux: NUL-separated, exact.
    const raw = readFileSync(`/proc/${ppid}/cmdline`, "utf8");
    if (raw) return raw.split("\0").join(" ");
  } catch {
    // Not Linux, or the process is gone.
  }
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(ppid)], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * Long-poll the phone's event stream and push each event straight into the
 * session. Deliberately fire-and-forget: MCP notifications have no response, so
 * there is nothing to await and nothing to retry against.
 *
 * Never throws out of the loop — this runs inside the tools server, and killing
 * it would take `call`/`text` down with it.
 */
function startChannelPump() {
  if (!channelActive()) {
    // Say so on stderr (which is the MCP server's debug log, never the model's
    // context) so "why didn't the channel fire" is answerable without guessing.
    console.error(
      `/call-me channel push idle: ${
        channelPushEnabled()
          ? `this session was not started with --channels ${CHANNELS_ENTRY}`
          : "channel_push is off (callme channel on)"
      }. monitors/inbound.mjs is delivering inbound events instead.`,
    );
    return;
  }

  console.error(`/call-me channel push active as ${MCP_SERVER_NAME}; the inbox monitor will stand down.`);

  // Claim BEFORE the first poll so the monitor stands down immediately, rather
  // than both delivering the first message that arrives during startup.
  claimChannel(stateKey);
  const heartbeat = setInterval(() => claimChannel(stateKey), 10_000);
  heartbeat.unref?.();

  // Hand delivery back cleanly on shutdown instead of making the monitor wait
  // out the claim TTL.
  //
  // The signal handlers MUST exit: attaching a listener replaces Node's default
  // terminate-on-signal behaviour, so a handler that only cleans up leaves the
  // process alive and Claude Code has to escalate SIGINT -> SIGTERM -> SIGKILL
  // on every session teardown.
  process.on("exit", () => releaseChannel(stateKey));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      releaseChannel(stateKey);
      process.exit(0);
    });
  }

  // A channel notification that the host declines to route is dropped in
  // silence, so there is otherwise no way to tell "nothing arrived from the
  // phone" apart from "this session never had a channel at all". CALLME_CHANNEL_SELFTEST=1
  // pushes one synthetic message at startup: see it in the session and the whole
  // path is proven; see nothing and the gate rejected us.
  if (process.env.CALLME_CHANNEL_SELFTEST === "1") {
    // Delayed, not immediate: the host attaches its channel notification handler
    // after the connection is established, so a push sent during initialization
    // is dropped on the floor. Real events never race this — they arrive from
    // the phone seconds or minutes later — but the self-test would.
    setTimeout(() => {
      void mcp
        .notification({
          method: "notifications/claude/channel",
          params: {
            content:
              "/call-me channel self-test: inbound push is working in this session. " +
              "Nothing is wrong and no reply is needed.",
            meta: { kind: "selftest" },
          },
        })
        .catch((error) => console.error(`/call-me channel self-test failed: ${error.message}`));
    }, 3_000).unref?.();
  }

  // Deferred by one tick, NOT called inline: the module body is suspended at the
  // top-level `await mcp.connect(...)` above, so `let sessionPromise` further
  // down has not been initialized yet. pumpLoop() reaches ensureSession()
  // synchronously before its first await, which would hit the temporal dead zone
  // and crash the server on startup.
  setImmediate(() => {
    void pumpLoop();
  });
}

async function pumpLoop() {
  const cursorFile = inboundCursorPath(stateKey);
  let cursor = null;

  for (;;) {
    try {
      forgetCachedNumber();
      const session = await ensureSession();
      if (cursor === null) cursor = restoreCursor(cursorFile, session.session_token);

      const query = new URLSearchParams({
        session_token: session.session_token,
        cursor: String(cursor),
        wait: "50",
      });
      const response = await requestJson(`/sessions/events?${query}`, { timeoutMs: 60_000 });
      cursor = response.cursor;

      for (const event of response.events || []) {
        if (!isFromPairedUser(event, pairedNumber())) continue;
        // Answering from the phone IS answering: disarm the waiter so it cannot
        // later wake the model to say they never replied.
        clearWaiter(stateKey);
        await mcp.notification({
          method: "notifications/claude/channel",
          params: { content: notificationText(event), meta: eventMeta(event) },
        });
      }

      writeJsonPrivate(cursorFile, { sessionToken: session.session_token, cursor });
    } catch (error) {
      console.error(`/call-me channel poll failed: ${error.message}`);
      // Force a session re-check on the next pass; a dead token is the common
      // cause and ensureSession() re-creates one.
      sessionPromise = null;
      cursor = null;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

function restoreCursor(cursorFile, sessionToken) {
  const saved = readJson(cursorFile);
  if (saved?.sessionToken === sessionToken && Number.isInteger(saved.cursor)) return saved.cursor;
  return 0;
}

function setupText() {
  const cli = process.env.CALLME_PLUGIN_ROOT
    ? `${process.env.CALLME_PLUGIN_ROOT}/skills/call-me/callme`
    : "callme";
  const paired = currentUserNumber();
  return [
    "Show these steps to the human as-is:",
    "",
    '1. Install "/call-me" (free) on your iPhone:',
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
    "   Without it the Stop hook only nudges sessions that already used /call-me,",
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
    console.error(`/call-me state save failed: ${error.message}`);
  }
}
