#!/usr/bin/env node

// Codex entrypoint for the local stdio MCP server. Unlike the hosted HTTP MCP
// endpoint, this process runs on the user's machine and can read the paired
// recipient from ~/.aiphone/config.json through the shared config helper.
process.env.CALLME_CLIENT_NAME ||= "Codex";
await import("../claude-code/dist/channel.mjs");
