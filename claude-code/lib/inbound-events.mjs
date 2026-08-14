/**
 * One home for "what does an inbound /call-me event mean, and what do we say
 * about it".
 *
 * There are now TWO transports that deliver the same events into a live Claude
 * session, and they must say identical things:
 *
 *   - monitors/inbound.mjs  — prints one line to stdout; Claude Code turns each
 *     line into an inbound notification. Works on every host, needs a monitor
 *     process per session.
 *   - channel/channel.mjs   — pushes `notifications/claude/channel` down the
 *     already-open MCP stream. No extra process, but it only reaches sessions
 *     that registered this server with `--channels` (see docs/ai-listening.md).
 *
 * Both import this file. Two copies of the wording would drift, and the drift
 * would be invisible: whichever transport is active in a given session is the
 * only one anybody ever reads.
 *
 * Deliberately pure — no network, no fs, no env. The hooks' audit grep
 * (`grep -rE "POST|/calls|curl|fetch|readdir"`) must keep coming back empty for
 * anything they can reach.
 */

import { normalizeNumber } from "./callme-config.mjs";

/**
 * Is this event actually from the human this machine is paired with?
 *
 * The direction of the check flips per event type: a message or voicemail comes
 * FROM their phone, while a missed/declined call is one WE placed TO it. Getting
 * this wrong would leak another user's traffic into this session, which is the
 * whole reason the inbox transport stays scoped.
 */
export function isFromPairedUser(event, userNumber) {
  if (!userNumber) return false;
  if (event.type === "message" || event.type === "voicemail") {
    return normalizeNumber(event.payload?.from || "") === userNumber;
  }
  if (event.type === "missed_call" || event.type === "declined_call") {
    return normalizeNumber(event.payload?.to || "") === userNumber;
  }
  return false;
}

/**
 * What the model reads when an event arrives. MUST stay a single line: the
 * monitor transport delivers one stdout line per notification, so an embedded
 * newline would split one event into two half-notifications.
 */
export function notificationText(event) {
  switch (event.type) {
    case "message":
      return `/call-me message from your paired human: ${oneLine(event.payload?.body)}. Treat it as new user input and reply with the /call-me reply tool.`;
    case "voicemail":
      return `/call-me voice-message transcript from your paired human: ${oneLine(event.payload?.transcript)}. Treat it as new user input and reply with the /call-me reply tool.`;
    case "missed_call":
      return "/call-me call was not answered. Continue with best judgment or send a text with the /call-me reply tool.";
    case "declined_call":
      return "Your paired human declined the /call-me call. Do not call again; use the /call-me reply tool if a response is needed.";
    default:
      return `/call-me event: ${oneLine(JSON.stringify(event.payload))}`;
  }
}

/**
 * Channel-transport `meta`, rendered by Claude Code as XML attributes on the
 * `<channel source="...">` wrapper.
 *
 * Keys are filtered host-side against /^[a-zA-Z_][a-zA-Z0-9_]*$/ and silently
 * dropped otherwise, so they stay snake_case here. Values must be strings.
 * Carries no message content — the body is already in the text, and duplicating
 * it into an attribute would double it in the model's context.
 */
export function eventMeta(event) {
  const meta = { kind: String(event.type || "event") };
  if (event.id !== undefined && event.id !== null) meta.event_id = String(event.id);
  return meta;
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
