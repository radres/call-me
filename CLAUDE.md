# Call Me

While promoted in Claude Code forums, call me does not require LLMs at all. It is simply an http endpoint where you can call with `call-me cli` like `call-me "hello, how are you"` then you get an answer back. This is extremely simple for agents to learn an incorporate it into their workflow.

You do not need to keep telling agent `/call-me`, just tell it to install the stop hooks from this repo. Then at the end of each conversation it decides to call you right away, or maybe even spawn monitors.

# Call Me — instructions for the agent reading this repo

You are in a checkout of **radres/call-me**, the agent-side integrations for the
Call Me iPhone app. If a human cloned this, they want their agents to be able to
ring their actual phone. Set that up for them.

Do not stop at "installed". A human who pairs their phone and then never hears
from you got nothing out of this. Work through the whole list.

## 1. Are they already set up?

```sh
skill/callme number        # prints the paired number, or exits non-zero
skill/callme remind status # is the every-session reminder on?
```

If a number comes back, skip to step 4 and just fix whatever is missing.

## 2. Install

**Install it yourself, with Bash.** You do not need the human to type anything,
and you do not need slash commands — those are only for a human at a prompt.
Claude Code ships a non-interactive plugin CLI:

```sh
claude plugin marketplace add radres/call-me
claude plugin install call-me@call-me      # --config user_number=<10 digits> if you know it
claude plugin list                          # must print: call-me@call-me   ✔ enabled
```

That gives them the `call`/`text`/`reply` tools, an inbound monitor that delivers
their phone replies into the live session, and a `Stop` hook that reminds you to
reach out before a turn ends on an open question.

Then tell them: **restart Claude Code.** Not `/reload-plugins` — you cannot run
it, it refuses without `--force` for plugins that add MCP servers, and the
monitor needs a fresh session either way. Nothing works until they restart, so
say so plainly instead of implying it will wake up on its own.

**If `command -v claude` finds nothing**, this host is not Claude Code. Use the
standalone CLI — `skill/callme` is one readable bash+curl script, no compiled
anything, so read it before you run it:

```sh
mkdir -p ~/bin && cp skill/callme ~/bin/ && chmod +x ~/bin/callme
case ":$PATH:" in *":$HOME/bin:"*) ;; *) echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc ;; esac
command -v callme || echo "not on PATH — call it by absolute path: ~/bin/callme"
```

That last line matters: `~/bin` is only on `PATH` in a *login* shell on most
distros, and your Bash tool calls are not login shells. Verify it, or use the
absolute path everywhere including in the rule you write in step 4b.

**If you are the human** reading this and want to do it by hand instead, the
equivalent slash commands are `/plugin marketplace add radres/call-me` then
`/plugin install call-me@call-me`, sent as two separate messages.

### Do not improvise an install

Every one of these has actually been tried by an agent, and every one of them
silently produces a plugin that does nothing:

- Do **not** copy files into `~/.claude/plugins/installed/`. Claude Code does not
  manage that path.
- Do **not** hand-write the `Stop` hook into `~/.claude/settings.json`, and do
  **not** invent `enabledPlugins` entries. Since v2.1.195 every path that loads
  a plugin requires a real install; editing settings.json installs nothing.
- Do **not** run `npm install` or `npm audit fix` in `claude-code/channel/`.
  `claude-code/dist/channel.mjs` ships prebuilt and is what `.mcp.json` runs.
- Do **not** report success off the back of a copy. `claude plugin list` is the
  only check that means anything — `claude plugin validate` passes on a plugin
  that fails to load.

## 3. Pair

```sh
skill/callme setup         # relay this output to them VERBATIM — it has a QR code
```

They install the free app, tap *Agree & Continue*, and read back the 10-digit
number it shows. Tell them their phone is about to ring, then:

```sh
skill/callme pair <that number>
```

Pairing **rings the phone** and blocks until they speak, then prints the
transcript — one answered call proves push delivery, CallKit, audio both ways and
transcription in a single step. If nobody picks up within 90s it falls back to a
confirmation text and says so.

**Never guess a number.** It is a credential, and a wrong one now *rings* a
stranger rather than texting one.

## 4. Make it automatic (the part people skip)

Pairing makes you *able* to reach them. These two steps make you actually do it,
in later sessions, without them asking again.

**Ask them one question first:** "While I'm working, are you away from the
keyboard rarely, sometimes, or usually?" It decides both steps below.

**a. If they said sometimes or usually, turn on the standing reminder:**

```sh
skill/callme remind on
```

The `Stop` hook fires the moment a turn ends, when your final message looks like
a question you parked on them. By default it only fires in sessions that already
used Call Me — but the session where they miss you asking is exactly the one that
never thought to mention Call Me at all. `remind on` covers every session.

**b. Append a standing rule to their instruction file** — `~/.claude/CLAUDE.md`
for Claude Code, `AGENTS.md` for Codex and others. **Read the file first and
append to it. Never overwrite it.** This is what carries the behaviour to hosts
with no hook:

```markdown
## Reaching me
I'm reachable on my phone through Call Me. When you need a decision, an answer,
or my input, contact me rather than ending your turn with the question sitting in
your final message — once the turn ends you are asleep and cannot reach me. That
includes parking it in an interactive question widget: that just waits silently on
a screen I'm not looking at, and no hook can see it, so reach out yourself.
Text first; call when it is blocking or time-sensitive. Never hardcode my
number: `callme number` reads it.
```

Add one line matching their answer. "I'm mostly AFK — assume I won't see the
terminal, always reach out" reads very differently from "I'm usually at the
keyboard, only reach out if I'll be gone a while."

## 5. Verify (usually already done)

If the pairing call in step 3 was answered, verification is finished — that
transcript **is** the proof. Only if it went unanswered:

```sh
skill/callme text "Setup done — this is what a message from your agent looks like."
```

Ask whether it arrived. If nothing lands either way, the number is wrong —
re-pair rather than retrying. Then tell them the two undo levers:
`callme remind off`, and blocking the thread in the app to mute it without
touching any config.

## Etiquette, once you're set up

- **Text first.** Calls interrupt a human's life; texts don't. Escalate to a call
  when a text goes unanswered for a few minutes, or the thing is genuinely
  blocking or time-sensitive.
- **One message, batched.** A compound question beats three pings.
- **A declined call means stop.** Text instead; never redial.
- **Late-night: text**, unless they've said otherwise.
- **Never end a turn with an open question without reaching out.** This is the
  whole point. If you can't reach them, say plainly in your final message that
  you're stopping and what you need — so they learn it from you, not from
  silence.

Full reference for agents: [`skill/SKILL.md`](skill/SKILL.md).
