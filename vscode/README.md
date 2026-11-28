# CallMeMCP: phone calls from your AI agent

Let your agent call their human.

This extension connects your editor's AI agent to [/call-me](https://callmemcp.com). When the agent is done,
blocked or needs a decision, it rings your phone (iPhone or Android), reads its question aloud and gets your
spoken answer back as text. It can also send you a text instead of ringing.

The extension adds no tools of its own. It registers one remote MCP server,
`https://callmemcp.com/mcp` (streamable HTTP, no sign-in), with your editor. Your agent then has the
/call-me tools: `call`, `say`, `poll_result`, `hang_up`, `text`, `wait_for_reply`, `play_audio`,
`set_thread_title` and `setup`.

## 1. Get the app

/call-me is a phone app: [App Store](https://callmemcp.com/go/vscode-ext) for iPhone,
[Google Play](https://callmemcp.com/go/play-vscode-ext) for Android. It is a paid subscription; the app shows the
plans. Open the app and its **My Number** screen shows your 10-digit /call-me
number. That number is all an agent needs to reach you. No account, no email.

## 2. Install the extension

Search for **CallMeMCP** in the Extensions view, or install `callmemcp.call-me`.

## 3. Ask your agent to call you

Tell your agent your number once and ask it to call you, for example:
*"When the tests pass, call me on 1234567890 and ask whether to deploy."*
If it has no number yet, the server's `setup` tool gives it the download links to show you.

To try the loop without a phone, use the demo line **5550001234**: it answers by itself.

## What happens in each editor

Each editor wires MCP servers differently, so the extension does different things. VS Code was run end to
end; for the others the API or file path was read from that editor's own shipped build on 2026-11-28.

| Editor | What the extension does | Checked |
|---|---|---|
| VS Code 1.101 or later, VSCodium | Registers the server through VS Code's MCP API. It shows under **MCP: List Servers**; agent mode can use the tools once it has started (VS Code may ask you to trust it first). Nothing is written to disk. | Run in VS Code 1.148.0: the server started, all nine tools listed, `setup` answered |
| Cursor | Registers the server through Cursor's own MCP API; it shows under Cursor Settings > Tools & MCP. If `~/.cursor/mcp.json` already lists /call-me, it registers nothing, so the tools do not appear twice. | Cursor 3.32.10 build, not run |
| Devin Desktop (formerly Windsurf) | Its agent does not read servers from extensions. After you confirm, adds the server to `~/.config/devin/mcp_config.json` (Windows: `%APPDATA%\devin\mcp_config.json`). An older Windsurf build gets `~/.codeium/windsurf/mcp_config.json`. | Devin Desktop 3.15.14 build |
| Kiro | Same, in `~/.kiro/settings/mcp.json`. | Kiro 1.5.49 build |
| Antigravity | Same, in `~/.gemini/config/mcp_config.json`, which the Antigravity IDE, app and CLI share. | Antigravity IDE 2.8.0 build |
| Trae | Same, in Trae's `User/mcp.json` (macOS: `~/Library/Application Support/Trae/User/mcp.json`, Linux: `~/.config/Trae/User/mcp.json`, Windows: `%APPDATA%\Trae\User\mcp.json`). | Trae 3.6.24 (international) build |
| Trae CN, VS Code before 1.101 | Nothing to register with and no known file. The command shows the URL to add in the editor's MCP settings and copies it. | |

In the editors that need a file, the extension asks once after install (**Add**, **Not now**, **Don't ask
again**). You can run **/call-me: Add MCP server to this editor** at any time instead. Reload the window or
refresh the editor's MCP panel afterwards if the server does not show up.

When the extension writes a config file, it asks first, adds one entry and leaves every other server and
setting in the file as it is. A file it cannot parse as plain JSON (for example one with comments) is left
alone: the entry goes on your clipboard and the file opens so you can paste it under `"mcpServers"`.

## Commands

- **/call-me: Add MCP server to this editor**: in editors that need a config file, writes it (after you
  confirm). In VS Code and Cursor it tells you where the server already shows up; elsewhere it copies the URL.
- **/call-me: Send a test text to my phone**: sends one text through `https://callmemcp.com/mcp`, to the number
  in the `callme.number` setting or one you type. Use 5550001234 to test without a phone.
- **/call-me: Get the phone app**: opens the App Store or Google Play page.

## Setting

| Setting | What it does |
|---|---|
| `callme.number` | Your 10-digit /call-me number. Only the test-text command uses it. VS Code's MCP API has no field to pass it to the server, so your agent still asks for the number once. |

## Privacy

The extension has no telemetry and reads no files outside the MCP config files listed above. It makes a
network request only when you run **Send a test text**. Your
editor talks to `https://callmemcp.com/mcp` when your agent uses the tools. What the service stores is in
the [privacy policy](https://callmemcp.com/privacy); the [terms](https://callmemcp.com/terms) are on the same
site. Questions: info@callmemcp.com.

## Licence

MIT. The /call-me service and apps are by Oztetik Solutions (Norway).
