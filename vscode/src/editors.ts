// Which editor is this, and where does its own agent read MCP servers from?
// No vscode import: the unit tests call these with made-up hosts.
//
// Checked against the editors' own builds on 2026-11-28 (Cursor 3.32.10, Devin
// Desktop 3.15.14, Kiro 1.5.49, Antigravity IDE 2.8.0, Trae 3.6.24):
// Cursor and Devin Desktop stub VS Code's MCP provider API; Kiro, Antigravity
// and Trae implement it, but their agents never read VS Code's MCP list.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EntryShape } from "./mcpConfig";

export type Route =
  /** VS Code's MCP API (vscode.lm.registerMcpServerDefinitionProvider). */
  | "provider"
  /** Cursor's own API (vscode.cursor.mcp.registerServer). */
  | "cursor"
  /** Neither reaches the agent: write the editor's MCP config file, after the user agrees. */
  | "file";

export interface ConfigTarget {
  /** Shown to the user, e.g. "Kiro (user settings)". */
  label: string;
  file: string;
  shape: EntryShape;
}

export interface Host {
  id: string;
  /** Name shown in messages, e.g. "Kiro". */
  name: string;
  route: Route;
  /** Files the "Add MCP server to this editor" command writes (Cursor: only if its API is missing). */
  targets: ConfigTarget[];
}

export interface Env {
  appName: string;
  uriScheme: string;
  /** Fork-only API namespaces seen on the vscode module, e.g. "cursor", "trae". */
  namespaces?: string[];
  platform?: NodeJS.Platform;
  home?: string;
  appData?: string;
  xdgConfig?: string;
  exists?: (file: string) => boolean;
}

const URL_KEY: EntryShape = { urlKey: "url" };
const SERVER_URL_KEY: EntryShape = { urlKey: "serverUrl" };

export function detectHost(env: Env): Host {
  const platform = env.platform ?? process.platform;
  const home = env.home ?? os.homedir();
  const appData = env.appData ?? process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  const xdg = env.xdgConfig ?? process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  const exists = env.exists ?? fs.existsSync;
  const scheme = (env.uriScheme || "").toLowerCase();
  const name = (env.appName || "").toLowerCase();
  const ns = new Set((env.namespaces ?? []).map((n) => n.toLowerCase()));
  const is = (s: string) => scheme === s || scheme.startsWith(s + "-") || name.includes(s);

  if (ns.has("cursor") || is("cursor")) {
    return {
      id: "cursor",
      name: "Cursor",
      route: "cursor",
      targets: [{ label: "Cursor", file: path.join(home, ".cursor", "mcp.json"), shape: URL_KEY }],
    };
  }
  if (is("devin")) {
    // Devin Desktop, formerly Windsurf. Both of its agents read this file.
    const dir = platform === "win32" ? path.join(appData, "devin") : path.join(xdg, "devin");
    return {
      id: "devin",
      name: "Devin Desktop",
      route: "file",
      targets: [{ label: "Devin Desktop", file: path.join(dir, "mcp_config.json"), shape: URL_KEY }],
    };
  }
  if (ns.has("windsurfauth") || is("windsurf")) {
    // A Windsurf build from before the rename: Cascade reads the Codeium file.
    return {
      id: "windsurf",
      name: "Windsurf",
      route: "file",
      targets: [
        { label: "Windsurf", file: path.join(home, ".codeium", "windsurf", "mcp_config.json"), shape: SERVER_URL_KEY },
      ],
    };
  }
  if (ns.has("kiroversion") || is("kiro")) {
    return {
      id: "kiro",
      name: "Kiro",
      route: "file",
      targets: [{ label: "Kiro", file: path.join(home, ".kiro", "settings", "mcp.json"), shape: URL_KEY }],
    };
  }
  if (ns.has("antigravityextensibility") || is("antigravity")) {
    // One file covers the Antigravity IDE, app and CLI. Builds before 2.x read
    // ~/.gemini/antigravity/; that file is updated too when it already exists.
    const targets: ConfigTarget[] = [
      { label: "Antigravity", file: path.join(home, ".gemini", "config", "mcp_config.json"), shape: SERVER_URL_KEY },
    ];
    const old = path.join(home, ".gemini", "antigravity", "mcp_config.json");
    if (exists(old)) targets.push({ label: "Antigravity (older builds)", file: old, shape: SERVER_URL_KEY });
    return { id: "antigravity", name: "Antigravity", route: "file", targets };
  }
  if (ns.has("trae") || is("trae")) {
    if (scheme.includes("cn") || name.includes("cn")) {
      // Trae CN keeps its settings elsewhere; not checked yet, so no file is written.
      return { id: "trae-cn", name: env.appName || "Trae CN", route: "file", targets: [] };
    }
    const userData =
      platform === "win32"
        ? appData
        : platform === "darwin"
          ? path.join(home, "Library", "Application Support")
          : xdg;
    return {
      id: "trae",
      name: "Trae",
      route: "file",
      targets: [{ label: "Trae", file: path.join(userData, "Trae", "User", "mcp.json"), shape: URL_KEY }],
    };
  }
  return { id: scheme || "vscode", name: env.appName || "VS Code", route: "provider", targets: [] };
}
