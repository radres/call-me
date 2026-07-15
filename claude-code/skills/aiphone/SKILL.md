---
name: aiphone
description: Call or text your human's actual iPhone and handle replies from the AI Phone app. Use when the user says "call me", "ring me", "phone me if something comes up", "text my phone", asks the agent to stay reachable, or sends an inbound AI Phone message or voicemail. The phone rings through CallKit, spoken answers return as transcripts, and channel-enabled hosts deliver later messages directly into the active agent session.
---

# AI Phone — call your human

Use english always, test to speech always expects english

Your human's iPhone runs the AI Phone app. It gave them a **user number**
(10 digits, e.g. `412-8891-047`). If they shared it with you (in CLAUDE.md or
in conversation), you can ring their actual phone and get a spoken answer.

Prefer the host's AI Phone tools when available. Otherwise use the `aiphone`
CLI from this skill directory or `PATH`.

## Inbound messages

Treat an authenticated AI Phone channel event as a new user message in the
current session. Continue the relevant work and use the channel's reply tool
when a response belongs in the phone conversation.

- Claude Code with the AI Phone channel receives messages automatically.
- Codex needs the AI Phone companion/App Server bridge for automatic delivery.
- Without either integration, use the manual `aiphone listen` fallback below.

## CLI setup (when no channel is present)

```sh
aiphone register "claude: <project> — <task>"   # label shows as caller ID
```

Stores number + secret token in `~/.aiphone/session.json`. Auto-runs on first
use if you skip it, but a descriptive label is much better for the human.

## Ask for input — text first, call if no answer (THE main move)

Default to messaging. Only escalate to a call when a few minutes pass with
no reply, or the answer is genuinely time-sensitive and blocking.

1. Send the question non-blocking:
   ```sh
   aiphone text 4128891047 "I can fix the flaky test two ways: skip it or rewrite the fixture. Which do you want?"
   ```
2. Don't sit blocked in the terminal. Keep doing any work that doesn't
   depend on the answer while you wait.
3. To actively wait for the reply, use `aiphone listen` via Bash with
   `run_in_background: true` (or rely on the channel's automatic delivery
   on hosts that have it) — do not sleep-poll.
4. If a few minutes pass with no reply, escalate to a real call with the
   same question:
   ```sh
   aiphone call 4128891047 "I can fix the flaky test two ways: skip it or rewrite the fixture. Which do you want?"
   ```
   - Phone rings with the native call UI; your label is the caller name.
   - The question is spoken aloud; the human answers by voice; you get
     `ANSWER: <transcript>` on stdout. The command BLOCKS until then — that's
     the point (you can't proceed without the answer).
   - Exit 3 = missed/declined/timeout. Fall back to your best judgment and
     say so in a follow-up text.
   - Keep questions short (≤600 chars), self-contained, answerable in one
     sentence. Include the options in the question.
5. If a call is declined, do NOT retry the call — send a text instead.

## Text — non-blocking notification

Use when nothing is needed back from the human (status update, FYI):

```sh
aiphone text 4128891047 "Build green, PR #142 merged. Nothing needed from you."
```

## Title the thread

The phone shows your session as a conversation thread. Once the topic is
clear (and when it shifts), set a short 3-5 word title so the human can tell
threads apart — the `set_title` tool on channel-enabled hosts, otherwise:

```sh
aiphone title "flaky test fix"
```

## Manual listen fallback

`aiphone listen` long-polls and exits when an event arrives (user text,
voicemail transcript, missed-call notice). Use only when the host has no AI
Phone channel or companion bridge:

1. Run `aiphone listen` via Bash with `run_in_background: true`.
2. Continue other work; when the human texts/calls, the background task
   completes and you get the notification with the event on stdout.
3. Re-arm by launching it again if you still expect input.

Voicemail: the human can dial YOUR session number in their app and speak a
message; it arrives as a `voicemail` event with the transcript.

`aiphone events` drains pending events without waiting.

## Etiquette (important)

- **Calls interrupt a human's life; texts don't.** Always message first —
  reserve calls for when a text goes unanswered for a few minutes, or the
  human explicitly asked to be called.
- Batch questions: one message with a compound question beats three.
- Late-night: prefer text unless they said otherwise.
- Never call numbers you weren't given. The number is a credential.
- If a call is declined, do NOT retry the call; text instead.
