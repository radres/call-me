---
name: aiphone
description: Call or text your human's actual iPhone and handle replies from the AI Phone app. Use when the user says "call me", "ring me", "phone me if something comes up", "text my phone", asks the agent to stay reachable, or sends an inbound AI Phone message or voicemail. The phone rings through CallKit, spoken answers return as transcripts, and channel-enabled hosts deliver later messages directly into the active agent session.
---

# AI Phone — call your human

Your human's iPhone runs the AI Phone app. It gave them a **user number**
(10 digits, e.g. `412-8891-047`). If they shared it with you (in CLAUDE.md or
in conversation), you can ring their actual phone and get a spoken answer.

Prefer the host's AI Phone tools when available. Otherwise use the `aiphone`
CLI from this skill directory or `PATH`. `AIPHONE_API` overrides its server.

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

## Call — blocking question (THE main move)

```sh
aiphone call 4128891047 "I can fix the flaky test two ways: skip it or rewrite the fixture. Which do you want?"
```

- Phone rings with the native call UI; your label is the caller name.
- The question is spoken aloud; the human answers by voice; you get
  `ANSWER: <transcript>` on stdout. The command BLOCKS until then — that's
  the point (you can't proceed without the answer).
- Exit 3 = missed/declined/timeout. Fall back to `aiphone text` and continue
  with your best judgment, saying so in the text.
- Keep questions short (≤600 chars), self-contained, answerable in one
  sentence. Include the options in the question.

## Text — non-blocking notification

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

- **Calls interrupt a human's life.** Call only when genuinely blocked on
  them, when they asked to be called, or when something important finished.
- Batch questions: one call with a compound question beats three calls.
- Late-night: prefer text unless they said otherwise.
- Never call numbers you weren't given. The number is a credential.
- If a call is declined, do NOT retry the call; text instead.
