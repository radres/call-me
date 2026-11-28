// Starts a real VS Code (downloaded by @vscode/test-electron) with this
// extension loaded and runs test/suite inside it.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const root = path.resolve(__dirname, "..", "..");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "callme-vscode-"));
  // Let chat and MCP run without a signed-in Copilot.
  fs.mkdirSync(path.join(userData, "User"), { recursive: true });
  fs.writeFileSync(
    path.join(userData, "User", "settings.json"),
    JSON.stringify({ "chat.mcp.enabled": true, "chat.mcp.autostart": "never", "workbench.startupEditor": "none" }),
  );
  try {
    await runTests({
      version: process.env.CALLME_VSCODE_VERSION || "stable",
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, "suite", "index.js"),
      launchArgs: [
        "--user-data-dir", userData, "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes",
        ...(process.env.CALLME_TRACE ? ["--log", "trace"] : []),
      ],
    });
  } finally {
    if (process.env.CALLME_KEEP_USERDATA) console.log(`user data kept in ${userData}`);
    else fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
