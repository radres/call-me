import * as vscode from "vscode";
import { detectHost, Host, ConfigTarget } from "./editors";
import { SERVER_URL, SERVER_NAME, mergeServer, readIfExists, writeAtomic, alreadyConfigured, buildEntry } from "./mcpConfig";

// The id of /call-me in the official MCP Registry. Using it as the provider id
// lets VS Code treat this and a registry install as the same server.
const PROVIDER_ID = "com.callmemcp/call-me";
const DEMO_NUMBER = "5550001234";
const DONT_ASK_KEY = "callme.dontOfferConfigFile";

// Shapes of the APIs this extension feature-detects at runtime, so it still
// loads in forks built on an older VS Code than the MCP API needs.
interface McpApi {
  registerMcpServerDefinitionProvider?: (
    id: string,
    provider: {
      onDidChangeMcpServerDefinitions?: vscode.Event<void>;
      provideMcpServerDefinitions(): unknown[];
    },
  ) => vscode.Disposable;
}
type McpHttpCtor = new (label: string, uri: vscode.Uri, headers?: Record<string, string>) => unknown;
interface CursorMcpApi {
  registerServer(config: { name: string; server: { url: string; headers?: Record<string, string> } }): void;
  unregisterServer(name: string): void;
}

// "registered": this extension registered the server through Cursor's API.
// "inConfig": ~/.cursor/mcp.json already lists /call-me, so nothing is registered
// (the agent would otherwise see every tool twice).
let cursorState: "registered" | "inConfig" | "none" = "none";

function cursorApi(): CursorMcpApi | undefined {
  const api = (vscode as unknown as { cursor?: { mcp?: CursorMcpApi } }).cursor?.mcp;
  return api && typeof api.registerServer === "function" ? api : undefined;
}

function providerApi(): { register: NonNullable<McpApi["registerMcpServerDefinitionProvider"]>; Http: McpHttpCtor } | undefined {
  const lm = (vscode as unknown as { lm?: McpApi }).lm;
  const Http = (vscode as unknown as { McpHttpServerDefinition?: McpHttpCtor }).McpHttpServerDefinition;
  if (!lm || typeof lm.registerMcpServerDefinitionProvider !== "function" || typeof Http !== "function") {
    return undefined;
  }
  return { register: lm.registerMcpServerDefinitionProvider.bind(lm), Http };
}

// Fork-only namespaces on the vscode module: steadier than appName, which
// Windsurf changed to "Devin" and Antigravity to "Antigravity IDE".
const FORK_NAMESPACES = ["cursor", "kiroVersion", "antigravityExtensibility", "trae", "windsurfAuth"];

function currentHost(): Host {
  const api = vscode as unknown as Record<string, unknown>;
  const namespaces = FORK_NAMESPACES.filter((n) => {
    try {
      return api[n] !== undefined && api[n] !== null;
    } catch {
      return false;
    }
  });
  return detectHost({ appName: vscode.env.appName, uriScheme: vscode.env.uriScheme, namespaces });
}

/** /go links are counted per place, so each editor gets its own slug. */
function storeLink(host: Host, android: boolean): string {
  const slug = `ext-${host.id.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "vscode"}`;
  return `https://callmemcp.com/go/${android ? "play-" : ""}${slug}`;
}

export function activate(context: vscode.ExtensionContext): void {
  const host = currentHost();

  // 1. VS Code (and any fork that implements its MCP API): register the server.
  //    Cursor stubs this API with a warning, so it is skipped there.
  const provider = host.route === "cursor" ? undefined : providerApi();
  if (provider) {
    context.subscriptions.push(
      provider.register(PROVIDER_ID, {
        provideMcpServerDefinitions: () => [new provider.Http(SERVER_NAME, vscode.Uri.parse(SERVER_URL))],
      }),
    );
  }

  // 2. Cursor: its own MCP API.
  const cursor = host.route === "cursor" ? cursorApi() : undefined;
  if (cursor && host.targets.some((t) => alreadyConfigured(t.file))) {
    cursorState = "inConfig";
  } else if (cursor) {
    try {
      cursor.registerServer({ name: SERVER_NAME, server: { url: SERVER_URL } });
      cursorState = "registered";
    } catch (err) {
      console.warn(`/call-me: Cursor did not take the MCP server: ${(err as Error).message}`);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("callme.addToEditor", () => addToEditor(host, !!provider)),
    vscode.commands.registerCommand("callme.sendTestText", () => sendTestText(host)),
    vscode.commands.registerCommand("callme.getApp", () => getApp(host)),
  );

  // 3. Editors whose agent reads only its own file (and a Cursor too old for
  //    its MCP API): offer once to write it.
  if (cursorState === "none" && host.route !== "provider") {
    void offerConfigFile(context, host);
  }
}

export function deactivate(): void {
  if (cursorState === "registered") {
    try {
      cursorApi()?.unregisterServer(SERVER_NAME);
    } catch {
      /* editor is shutting down */
    }
  }
}

function missingTargets(host: Host): ConfigTarget[] {
  return host.targets.filter((t) => !alreadyConfigured(t.file));
}

async function offerConfigFile(context: vscode.ExtensionContext, host: Host): Promise<void> {
  if (context.globalState.get<boolean>(DONT_ASK_KEY)) return;
  const missing = missingTargets(host);
  if (missing.length === 0) return;
  const add = "Add";
  const never = "Don't ask again";
  const pick = await vscode.window.showInformationMessage(
    (host.route === "cursor"
      ? "/call-me: this Cursor has no MCP API for extensions. "
      : `/call-me: ${host.name}'s agent does not read MCP servers from extensions. `) +
      `Add the /call-me server (${SERVER_URL}) to ${missing.map((t) => t.file).join(" and ")}?`,
    add,
    "Not now",
    never,
  );
  if (pick === add) await writeTargets(host, missing);
  else if (pick === never) await context.globalState.update(DONT_ASK_KEY, true);
}

async function addToEditor(host: Host, providerRegistered: boolean): Promise<void> {
  if (host.route === "provider") {
    if (!providerRegistered) {
      const copy = "Copy URL";
      const pick = await vscode.window.showWarningMessage(
        `/call-me: ${host.name} ${vscode.version} has no MCP server API for extensions (VS Code 1.101 or later has). ` +
          `Add ${SERVER_URL} as a remote (HTTP) MCP server in its settings instead.`,
        copy,
      );
      if (pick === copy) await vscode.env.clipboard.writeText(SERVER_URL);
      return;
    }
    const list = "List MCP servers";
    const pick = await vscode.window.showInformationMessage(
      `/call-me is already registered with ${host.name} by this extension. ` +
        "Start it from MCP: List Servers, or just ask your agent to call you.",
      list,
    );
    if (pick === list) await vscode.commands.executeCommand("workbench.mcp.listServer");
    return;
  }
  if (host.route === "cursor" && cursorState === "registered") {
    void vscode.window.showInformationMessage(
      "/call-me is registered with Cursor by this extension. It shows under Cursor Settings > Tools & MCP.",
    );
    return;
  }
  if (host.targets.length === 0) {
    // An editor whose MCP config file is not known (Trae CN): never guess a path.
    const copy = "Copy URL";
    const pick = await vscode.window.showWarningMessage(
      `/call-me does not know where ${host.name} keeps its MCP servers. ` +
        `Add ${SERVER_URL} as a remote (HTTP) MCP server in ${host.name}'s MCP settings.`,
      copy,
    );
    if (pick === copy) await vscode.env.clipboard.writeText(SERVER_URL);
    return;
  }
  const missing = missingTargets(host);
  if (missing.length === 0) {
    const open = "Open file";
    const pick = await vscode.window.showInformationMessage(
      `/call-me is already in ${host.name}'s MCP config (${host.targets.map((t) => t.file).join(" and ")}).`,
      open,
    );
    if (pick === open && host.targets[0]) await openFile(host.targets[0].file);
    return;
  }
  const add = "Add";
  const pick = await vscode.window.showInformationMessage(
    `Add the /call-me MCP server to ${host.name}? This adds one entry to ${missing.map((t) => t.file).join(" and ")} ` +
      "and leaves every other server as it is.",
    { modal: true },
    add,
  );
  if (pick === add) await writeTargets(host, missing);
}

async function writeTargets(host: Host, targets: ConfigTarget[]): Promise<void> {
  const done: string[] = [];
  for (const t of targets) {
    let text: string | undefined;
    try {
      text = readIfExists(t.file);
    } catch (err) {
      void vscode.window.showErrorMessage(`/call-me: could not read ${t.file}: ${(err as Error).message}`);
      continue;
    }
    const result = mergeServer(text, t.shape);
    if (result.kind === "present") {
      done.push(t.file);
      continue;
    }
    if (result.kind === "unreadable") {
      // Do not rewrite a file we cannot parse (comments, trailing commas):
      // hand the user the entry to paste instead.
      const snippet = JSON.stringify({ [SERVER_NAME]: buildEntry(t.shape) }, null, 2);
      await vscode.env.clipboard.writeText(snippet);
      void vscode.window.showWarningMessage(
        `/call-me left ${t.file} unchanged: ${result.reason}. The entry is on your clipboard; paste it under "mcpServers".`,
      );
      await openFile(t.file);
      continue;
    }
    try {
      writeAtomic(t.file, result.text);
      done.push(t.file);
    } catch (err) {
      void vscode.window.showErrorMessage(`/call-me: could not write ${t.file}: ${(err as Error).message}`);
    }
  }
  if (done.length > 0) {
    const open = "Open file";
    const pick = await vscode.window.showInformationMessage(
      `/call-me added to ${done.join(" and ")}. If ${host.name}'s MCP panel does not show it yet, refresh it there or reload the window.`,
      open,
    );
    if (pick === open) await openFile(done[0]);
  }
}

async function openFile(file: string): Promise<void> {
  try {
    await vscode.window.showTextDocument(vscode.Uri.file(file));
  } catch {
    /* file may not exist */
  }
}

async function sendTestText(host: Host): Promise<void> {
  const config = vscode.workspace.getConfiguration("callme");
  let number = (config.get<string>("number") || "").replace(/\D/g, "");
  if (number.length !== 10) {
    const entered = await vscode.window.showInputBox({
      title: "/call-me: Send a test text",
      prompt: `Your 10-digit /call-me number, from My Number in the app. ${DEMO_NUMBER} is a demo line that answers by itself.`,
      placeHolder: DEMO_NUMBER,
      validateInput: (v) => (v.replace(/\D/g, "").length === 10 ? undefined : "10 digits"),
    });
    if (!entered) return;
    number = entered.replace(/\D/g, "");
    if (number !== DEMO_NUMBER) {
      const save = "Save in settings";
      void vscode.window
        .showInformationMessage("Keep this /call-me number for the next test?", save)
        .then((p) => (p === save ? config.update("number", number, vscode.ConfigurationTarget.Global) : undefined));
    }
  }
  const body = `Test from the /call-me extension in ${host.name}. Your agent can reach you here.`;
  try {
    const res = await fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "text", arguments: { to: number, body, from_label: `${host.name} (/call-me extension)` } },
      }),
    });
    const reply = (await res.json()) as {
      result?: { isError?: boolean; structuredContent?: { delivered?: boolean; notice?: string }; content?: { text?: string }[] };
      error?: { message?: string };
    };
    const result = reply.result;
    if (!res.ok || reply.error || !result || result.isError) {
      const why = reply.error?.message || result?.content?.[0]?.text || `HTTP ${res.status}`;
      void vscode.window.showErrorMessage(`/call-me: the test text was not sent: ${why}`);
      return;
    }
    const s = result.structuredContent || {};
    if (s.delivered === false) {
      void vscode.window.showWarningMessage(
        `/call-me: saved to your history, but no notification showed on the phone${s.notice ? `: ${s.notice}` : "."}`,
      );
    } else {
      void vscode.window.showInformationMessage(
        number === DEMO_NUMBER
          ? "/call-me: the demo line got the test text. Set your own number to try it on your phone."
          : "/call-me: test text sent. Check your phone.",
      );
    }
  } catch (err) {
    void vscode.window.showErrorMessage(`/call-me: could not reach ${SERVER_URL}: ${(err as Error).message}`);
  }
}

async function getApp(host: Host): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: "iPhone", description: "App Store", android: false },
      { label: "Android", description: "Google Play", android: true },
    ],
    { title: "Get /call-me for your phone" },
  );
  if (pick) await vscode.env.openExternal(vscode.Uri.parse(storeLink(host, pick.android)));
}
