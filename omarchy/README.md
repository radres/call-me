# callme Omarchy plugin

This is the Omarchy integration for `callme`, published from the repository
root so it can be installed with the standard Omarchy plugin command.

> Is your server down at night? Get your agent to call you. Flat $5 fee,
> infinite calls with the /call-me app. Calls have never been easier than just
> making an HTTP request.

It adds a small setup panel with:

- paired-number status from `~/.aiphone/config.json`
- an App Store/setup link
- local pairing, `Pair again`, and two-step `Clear pairing` controls
- copyable instructions for AI agents, MCP clients, and `curl`
- optional `Test calls` controls for explicit `Text me` and `Call me` actions

## Install

The repository is public and the Omarchy manifest is at its root:

```bash
omarchy plugin add https://github.com/radres/call-me --enable
```

Remove it with:

```bash
omarchy plugin remove radres.call-me
```

The panel reads and writes the same local pairing file used by `callme`
CLI and Claude Code integration. `Pair number` saves the 10-digit number
locally; it does not ring the phone. Use `Text me` for a safe delivery test
before making a voice call. `Clear pairing` removes only the saved number and
its local metadata, preserving other `callme` settings.

The panel calls the tokenless `callme` HTTP API directly. It never stores a
phone number or API credential in `shell.json` or this repository. Treat the
10-digit number as a bearer credential: do not paste it into public issues,
repositories, or prompts shared with other people.

## Using the paired number

Open the panel by searching `/call-me` or `callme` with `Super+Space`. The
compact home view shows paired status and a primary **Copy AI prompt** action.

- **Connect your AI** expands into separate Local Codex, Claude Code, Gemini CLI,
  OpenCode, Cursor, ChatGPT, claude.ai, other MCP client, and HTTP example
  sections. Open a section to select its instructions or copy that section.
- **Test calls** reveals the message box and explicit Text me / Call me actions.
- **Manage phone** contains Copy number, Pair again, and two-step Clear pairing.

The panel stays within the screen with a scrolling body; its header, Close
button, and clipboard confirmation remain visible. Escape and clicking outside
also dismiss it. Up/Down (or j/k) move through the controls. Right (or l)
opens the highlighted expandable section, while Left (or h) closes it. Enter or
Space activates the selected control, and text fields keep their normal editing
behavior.

Instruction text can be selected directly with the mouse. When a selection is
made, it is copied automatically and the panel briefly shows **Copied to
clipboard**; the explicit copy buttons behave the same way.

The same MCP endpoint also works with other MCP clients; see the repository
root README for configuration examples. `/ring` waits for a spoken answer;
`/text` sends a push notification without calling.

The manual message box and `Text me` / `Call me` buttons stay hidden until you
click **Test calls**. They are only for checking delivery from the desktop;
the main `callme` workflow is your AI using the MCP endpoint or HTTP API,
including while you are away from the keyboard overnight.

## Omarchy integration map

This is a panel-only plugin. It has no persistent bar icon because
setup is a one-time task; day-to-day use happens through the AI/MCP tools.
Omarchy also supports `menu`, `overlay`, `service`, and full `bar` plugins.
See the [Omarchy plugin development guide](https://plugins.omarchy.org/develop.html)
for the current plugin API.

Useful next integrations are:

- an optional Hyprland keybinding in `~/.config/hypr/bindings.lua` for a fast
  summon/toggle action
- a background `service` that watches inbound replies and forwards them as
  Omarchy notifications or into the active agent session
- an urgent `overlay` for an incoming `callme` reply or missed call
- a small history/inbox panel for recent calls, texts, transcripts, and
  delivery status

The first two are simple local integrations; the service and inbox should be
added only after deciding how notifications and agent-session routing should
behave.

## Local validation

From the repository root:

```bash
omarchy plugin validate .
```

For private shell testing, copy this folder to the user plugin directory and
rescan it:

```bash
mkdir -p ~/.config/omarchy/plugins/radres.call-me
cp -a . ~/.config/omarchy/plugins/radres.call-me/
omarchy-shell shell rescanPlugins
omarchy plugin list
```

The published source is the public `radres/call-me` repository. The manifest at
the repository root points to `omarchy/Panel.qml`; the other directories contain
the project's optional AI integrations.

## App Store identity and launcher

There is no persistent bar or panel icon. The setup entry appears in
Super+Space with the callme App Store handset artwork because this surface is
intended for one-time configuration.

After installing the plugin, register the Super+Space entry:

```bash
bash ~/.config/omarchy/plugins/radres.call-me/install-launcher.sh
```

Search `callme`, `call-me`, or `phone`, then press Enter to open the panel.
The script installs a standard desktop entry under XDG_DATA_HOME (default
`~/.local/share`). It can be rerun after plugin updates.
