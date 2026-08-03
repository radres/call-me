# Call Me

Call me app is an app that assigns a Voip number to your phone for agents or services to call by text. Text is converted in a server to voice so one can listen and answer even while driving or running.

# Agent integrations

Your AI agents can ring your actual iPhone, speak a question, and get your
spoken answer back as text — or just text you. This repo has the agent-side
integrations for the **Call Me** iOS app (formerly AI Phone).



## 1. Get the app

**[Call Me on the App Store](https://serdaroztetik.com/aiphone/go/readme)** — free.
No registration, no email. Open it, tap *Agree & Continue*, and it shows your
personal **Call Me number**: 10 digits, and all an agent needs to reach you.

Already in a terminal with the CLI? `callme qr` prints a scannable QR code for
that link.

## 2. Ring your phone — one command, nothing installed

```bash
curl -sS https://serdaroztetik.com/aiphone/ring \
  -H 'content-type: application/json' \
  -d '{"to":"<YOUR_10_DIGIT_NUMBER>","text":"Should I deploy to prod?"}'
# rings your iPhone, blocks until you answer, then:
# {"status":"completed","transcript":"Yes, go ahead"}
```

That is the whole product. No token, no signup, no plugin — give that line to
any agent that can run a shell command and it can reach you.

Just notify instead of asking? Same shape, `/text` with a `body`:

```bash
curl -sS https://serdaroztetik.com/aiphone/text \
  -H 'content-type: application/json' \
  -d '{"to":"<YOUR_10_DIGIT_NUMBER>","body":"Migration finished."}'
```

Add `"from":"Deploy Bot"` to either one to name the thread on your phone —
repeat calls with the same name stay in one conversation. `/ring` also takes
`"timeout_s"` (default 300) and returns a `session_token` you can use on the
full API (`/calls`, `/messages`, `/sessions/events` for replies) if you ever
want more than one-shot sends.



## 3. Optional: connect Claude Code for everyday use

claude code folder also includes hooks for claude to call you after long-running sessions.

Send these as **three separate messages** (slash commands only run one per
message):

```
/plugin marketplace add radres/call-me
```

```
/plugin install call-me@call-me
```

```
/plugin enable call-me@call-me
```

**Do not skip the third one.** `install` leaves the plugin *disabled* — it says
so in its own output — and a disabled plugin gives Claude no `call`/`text`
tools at all, so nothing will ever reach your phone.

Then **restart Claude Code** — the inbound monitor only comes up in a fresh
session.

<details>
<summary>Prefer one line in a terminal, or want to just ask Claude to do it?</summary>

Same thing, non-interactively — this also works before Claude Code has ever been
launched, and an agent can run it itself:

```sh
claude plugin marketplace add radres/call-me
claude plugin install call-me@call-me
claude plugin enable call-me@call-me   # REQUIRED — install leaves it disabled
claude plugin list                     # expect: call-me@call-me   ✔ enabled
```

So "install Call Me for me" is a complete instruction — you don't have to type
the slash commands yourself.
</details>

Then paste this message, and Claude does the rest of the setup itself:

```
Set up Call Me for me, all of it — not just pairing. If the plugin isn't
installed yet, install it yourself with the `claude plugin` shell commands. Run
the setup tool and show me its output verbatim so I can scan the QR code. Ask me
how often I'm away from the keyboard, then based on my answer: turn on the
standing reminder if it fits, append a "## Reaching me" rule to my
~/.claude/CLAUDE.md (read it first and append — don't overwrite), and prove it
works end to end. Tell me how to undo both when you're done.
```

That gets you the fully automated setup: Claude can reach your phone, **and** it
will actually do so in future sessions instead of parking a question in a final
message and going to sleep. Concretely it sets up:

| | What it does |
|---|---|
| **`call` / `text` / `reply` tools** | Claude rings your phone or texts it; your spoken answer comes back as text |
| **Inbound monitor** | Replies you send from the app land in the live Claude session, even hours later |
| **`Stop` hook + answer waiter** | If a turn ends on a question Claude parked on you, you get a grace period (2 min) to just answer in the terminal. Type anything and nothing happens; let it lapse and Claude is woken up to text or call you. The hooks only wake Claude — the decision to dial stays with the model |
| **`~/.claude/CLAUDE.md` rule** | Carries the behaviour to every session and to hosts with no hook |

The number lands in `~/.aiphone/config.json`, so **every** Claude session on the
machine reaches your phone, and re-pairing to a new phone takes effect
immediately without restarting anything. You can also paste the number into the
plugin's config field when prompted — same result.

Levers afterwards: `callme remind off` stops the every-session reminder,
`callme grace <seconds>` sets how long you get to answer at the keyboard before
your phone is involved (`0` = immediately), and blocking a thread in the app mutes
it without touching any config.

## 4. Any other agent (Codex, scripts, cron jobs, …)

Use the standalone skill in [`skill/`](skill/). It's a single bash+curl CLI:

```sh
git clone https://github.com/radres/call-me
cp call-me/skill/callme ~/bin/   # or anywhere on PATH

callme pair 5551234567                  # once — the number from the app
callme call "Deploy staging or prod first?"   # blocks until you answer by voice
callme text "Build green, PR merged."         # push notification
```

Agents that support skills can point at [`skill/SKILL.md`](skill/SKILL.md)
directly — it teaches the full flow (setup, pair, call, text, listen, title).

## Teach your agent

The setup in step 3 writes this for you. If you'd rather do it by hand, append it
to your `CLAUDE.md` / `AGENTS.md`:

```markdown
## Reaching me
I'm reachable on my phone through Call Me. When you need a decision, an answer,
or my input, contact me rather than ending your turn with the question sitting in
your final message — once the turn ends you are asleep and cannot reach me.
Text first; call when it is blocking or time-sensitive. Never hardcode my
number: `callme number` reads it.
```

Add a line about how reachable you actually are — "I'm mostly AFK, assume I won't
see the terminal" produces very different behaviour from "I'm usually at the
keyboard." That one line is the difference between an agent that pings you
constantly and one that never does.

Notice there's no number in there: the number is a credential, so it lives in
`~/.aiphone/config.json` (mode 0600) instead of your notes. `callme number`
reads it back, `callme pair <number>` changes it.

**Cloned this repo?** Then you don't need any of the above — `CLAUDE.md` at the
repo root is picked up automatically, and it walks your agent through the whole
setup. Just say "set up Call Me".

## How it works

- `callme call` POSTs your question to the Call Me service; your iPhone
  rings through CallKit like a real call, TTS speaks the question, your
  spoken reply is transcribed and returned to the agent. The call blocks
  until you answer — that's the point.
- `callme text` sends a push-notification message; replies from the phone
  are delivered back into channel-enabled agent sessions (Claude Code plugin)
  or fetched with `callme listen` / `callme events`.
- Each agent session registers its own number and thread, so your phone shows
  separate, titled conversations per task.
