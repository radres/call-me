# Changelog

## 0.1.0 (2026-11-28)

- First release. Registers the /call-me MCP server (`https://callmemcp.com/mcp`) with VS Code's MCP API and
  with Cursor's own MCP API.
- **/call-me: Add MCP server to this editor** writes the server into the editor's own MCP config file in
  editors whose agent does not read servers from extensions (Devin Desktop / Windsurf, Kiro, Antigravity,
  Trae), after you confirm. It adds one entry and leaves every other server as it is.
- **/call-me: Send a test text to my phone** and **/call-me: Get the phone app**.
