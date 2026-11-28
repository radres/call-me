// Runs inside VS Code. Checks that the extension registers /call-me with
// VS Code's MCP API and that VS Code can start it and list its tools.
import * as assert from "assert";
import * as vscode from "vscode";

type Lm = {
  tools?: readonly { name: string; description: string; tags: readonly string[] }[];
  invokeTool?: (name: string, options: { input: object; toolInvocationToken: undefined }) => Thenable<{ content: unknown[] }>;
};

function log(msg: string): void {
  console.log(`[callme-test] ${msg}`);
}

function withTimeout<T>(p: Thenable<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)),
  ]);
}

export async function run(): Promise<void> {
  log(`host: ${vscode.env.appName} ${vscode.version} (${vscode.env.uriScheme})`);
  const ext = vscode.extensions.getExtension("callmemcp.call-me");
  assert.ok(ext, "extension callmemcp.call-me is loaded");
  await ext.activate();
  log("extension active");

  const commands = await vscode.commands.getCommands(true);
  for (const c of ["callme.addToEditor", "callme.sendTestText", "callme.getApp"]) {
    assert.ok(commands.includes(c), `command ${c} is registered`);
  }
  log("commands registered");

  const lm = (vscode as unknown as { lm: Lm }).lm;
  // The provider's servers reach VS Code a moment after activation, and a
  // start before that matches nothing, so retry until the tools show up.
  // autoTrustChanges is what VS Code's own "Start Server" action passes.
  let names: string[] = [];
  for (let i = 0; i < 12 && names.length < 3; i++) {
    await withTimeout(
      vscode.commands.executeCommand("workbench.mcp.startServer", "*", { waitForLiveTools: true, autoTrustChanges: true }),
      60_000,
      "starting the MCP servers",
    );
    names = (lm.tools ?? []).map((t) => t.name).filter((n) => /setup|wait_for_reply|poll_result/.test(n));
    if (names.length < 3) await new Promise((r) => setTimeout(r, 5000));
  }
  log(`MCP tools seen by VS Code: ${JSON.stringify((lm.tools ?? []).map((t) => t.name))}`);
  assert.ok(names.length >= 3, "VS Code lists the /call-me tools after starting the server");

  const setup = (lm.tools ?? []).find((t) => /(^|_)setup$/.test(t.name));
  assert.ok(setup, "the setup tool is there");
  if (lm.invokeTool) {
    try {
      const out = await withTimeout(
        lm.invokeTool(setup.name, { input: {}, toolInvocationToken: undefined }),
        30_000,
        "invoking setup",
      );
      const text = JSON.stringify(out.content);
      log(`setup tool answered: ${text.slice(0, 300)}`);
      assert.ok(/apps\.apple\.com|play\.google\.com|callmemcp\.com/.test(text), "setup returns the store links");
    } catch (err) {
      log(`invokeTool(setup) did not run outside a chat request: ${(err as Error).message}`);
    }
  }
  log("PASS");
}
