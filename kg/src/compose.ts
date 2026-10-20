// Run docker compose for the knowledge graph, after checking the Docker engine
// responds (a stopped Docker Desktop otherwise makes compose hang indefinitely).
// Usage: node kg/src/compose.ts up|down
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const ROOT = join(import.meta.dirname, "..", "..");
const COMMANDS: Record<string, string[]> = {
  up: ["up", "-d", "--wait", "--wait-timeout", "180"],
  down: ["down"],
};

const action = process.argv[2];
if (!action || !COMMANDS[action]) {
  console.error("usage: node kg/src/compose.ts up|down");
  process.exit(1);
}

try {
  const { stdout } = await promisify(execFile)("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 10_000 });
  if (!stdout.trim()) throw new Error("no server version");
} catch {
  console.error(
    [
      "The Docker engine is not responding, so docker compose would hang.",
      "",
      "Start Docker Desktop (or restart it: tray icon → Restart, or Troubleshoot → Restart Docker Desktop)",
      "and wait until it reports that the engine is running. If it still doesn't respond from WSL,",
      "run `wsl --shutdown` in PowerShell, start Docker Desktop, and reopen your terminal.",
      "Check with: docker version",
    ].join("\n"),
  );
  process.exit(1);
}

const args = ["compose", "--env-file", join(ROOT, ".env"), "-f", join(ROOT, "kg", "docker-compose.yml"), ...COMMANDS[action]];
const child = spawn("docker", args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
