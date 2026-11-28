import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mergeServer, writeAtomic, alreadyConfigured, SERVER_URL } from "../src/mcpConfig";
import { detectHost } from "../src/editors";

test("adds the server to a missing or empty file", () => {
  for (const text of [undefined, "", "  \n"]) {
    const r = mergeServer(text, { urlKey: "url" });
    assert.equal(r.kind, "added");
    if (r.kind === "added") {
      assert.deepEqual(JSON.parse(r.text), { mcpServers: { "call-me": { url: SERVER_URL } } });
    }
  }
});

test("keeps every other server and top-level key", () => {
  const before = { theme: "x", mcpServers: { github: { command: "gh", args: ["mcp"], env: { T: "1" } } } };
  const r = mergeServer(JSON.stringify(before), { urlKey: "serverUrl" });
  assert.equal(r.kind, "added");
  if (r.kind === "added") {
    const after = JSON.parse(r.text);
    assert.deepEqual(after.mcpServers.github, before.mcpServers.github);
    assert.equal(after.theme, "x");
    assert.deepEqual(after.mcpServers["call-me"], { serverUrl: SERVER_URL });
  }
});

test("does nothing when /call-me is already there under any name or URL key", () => {
  for (const entry of [{ url: SERVER_URL }, { serverUrl: SERVER_URL + "/" }, { url: "https://serdaroztetik.com/aiphone/mcp" }]) {
    const r = mergeServer(JSON.stringify({ mcpServers: { phone: entry } }), { urlKey: "url" });
    assert.deepEqual(r, { kind: "present", key: "phone" });
  }
});

test("never overwrites someone else's call-me entry", () => {
  const r = mergeServer(JSON.stringify({ mcpServers: { "call-me": { url: "https://example.com/mcp" } } }), { urlKey: "url" });
  assert.equal(r.kind, "added");
  if (r.kind === "added") {
    const after = JSON.parse(r.text);
    assert.equal(after.mcpServers["call-me"].url, "https://example.com/mcp");
    assert.equal(after.mcpServers.callmemcp.url, SERVER_URL);
  }
});

test("refuses files it cannot parse instead of rewriting them", () => {
  assert.equal(mergeServer('{ // comment\n "mcpServers": {} }', { urlKey: "url" }).kind, "unreadable");
  assert.equal(mergeServer("[]", { urlKey: "url" }).kind, "unreadable");
  assert.equal(mergeServer('{"mcpServers": []}', { urlKey: "url" }).kind, "unreadable");
});

test("writeAtomic creates private files and keeps an existing file's mode", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "callme-"));
  const fresh = path.join(dir, "a", "b", "mcp.json");
  writeAtomic(fresh, "{}\n");
  assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
  const existing = path.join(dir, "existing.json");
  fs.writeFileSync(existing, "{}", { mode: 0o644 });
  fs.chmodSync(existing, 0o644);
  writeAtomic(existing, JSON.stringify({ mcpServers: { x: { url: SERVER_URL } } }));
  assert.equal(fs.statSync(existing).mode & 0o777, 0o644);
  assert.ok(alreadyConfigured(existing));
  assert.ok(!alreadyConfigured(fresh));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
  fs.rmSync(dir, { recursive: true });
});

test("detects each editor and its route", () => {
  const base = { home: "/h", xdgConfig: "/h/.config", appData: "/appdata", exists: () => false };
  const host = (appName: string, uriScheme: string, extra: Partial<Parameters<typeof detectHost>[0]> = {}) =>
    detectHost({ appName, uriScheme, platform: "linux", ...base, ...extra });
  const file = (h: ReturnType<typeof detectHost>) => h.targets.map((t) => `${t.file} ${t.shape.urlKey}`);

  // VS Code and forks that leave MCP to VS Code's own list.
  for (const [n, s] of [["Visual Studio Code", "vscode"], ["Visual Studio Code - Insiders", "vscode-insiders"], ["VSCodium", "vscodium"]]) {
    const h = host(n, s);
    assert.equal(h.route, "provider");
    assert.deepEqual(h.targets, []);
  }

  // Cursor: its own API; the file is only checked so it is not registered twice.
  const cursor = host("Cursor", "cursor");
  assert.equal(cursor.route, "cursor");
  assert.deepEqual(file(cursor), ["/h/.cursor/mcp.json url"]);
  assert.equal(host("Something", "x", { namespaces: ["cursor"] }).route, "cursor");

  // Devin Desktop (Windsurf renamed): XDG on macOS and Linux, APPDATA on Windows.
  assert.deepEqual(file(host("Devin", "devin")), ["/h/.config/devin/mcp_config.json url"]);
  assert.deepEqual(file(host("Devin", "devin", { platform: "darwin" })), ["/h/.config/devin/mcp_config.json url"]);
  assert.deepEqual(file(host("Devin", "devin", { platform: "win32" })), ["/appdata/devin/mcp_config.json url"]);
  // An older Windsurf build.
  assert.deepEqual(file(host("Windsurf", "windsurf")), ["/h/.codeium/windsurf/mcp_config.json serverUrl"]);
  assert.equal(host("Windsurf Next", "windsurf-next").id, "windsurf");

  // Kiro: one path on every OS; the namespace alone is enough.
  assert.deepEqual(file(host("Kiro", "kiro")), ["/h/.kiro/settings/mcp.json url"]);
  assert.equal(host("Code - OSS", "code-oss", { namespaces: ["kiroVersion"] }).id, "kiro");

  // Antigravity: the shared ~/.gemini/config file, plus the old one only if it exists.
  assert.deepEqual(file(host("Antigravity IDE", "antigravity-ide")), ["/h/.gemini/config/mcp_config.json serverUrl"]);
  assert.deepEqual(
    file(host("Antigravity", "antigravity", { exists: (f) => f === "/h/.gemini/antigravity/mcp_config.json" })),
    ["/h/.gemini/config/mcp_config.json serverUrl", "/h/.gemini/antigravity/mcp_config.json serverUrl"],
  );

  // Trae: the user-data folder per OS; Trae CN is not guessed.
  assert.deepEqual(file(host("Trae", "trae", { platform: "darwin" })), [
    "/h/Library/Application Support/Trae/User/mcp.json url",
  ]);
  assert.deepEqual(file(host("Trae", "trae")), ["/h/.config/Trae/User/mcp.json url"]);
  assert.deepEqual(file(host("Trae", "trae", { platform: "win32" })), ["/appdata/Trae/User/mcp.json url"]);
  const cn = host("Trae CN", "trae-cn");
  assert.equal(cn.route, "file");
  assert.deepEqual(cn.targets, []);
});
