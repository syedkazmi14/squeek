// Runs the TTS backend and the Electron app together; closing the app stops the backend.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");

const server = spawn(process.execPath, ["server.js"], { cwd: root, stdio: "inherit" });
const app = spawn(electronBinary, ["."], { cwd: root, stdio: "inherit" });

let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.kill();
  app.kill();
  process.exitCode = code;
}

app.on("exit", (code) => shutdown(code ?? 0));
server.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`[start] backend exited (code ${code}); the app keeps running (is port 3000 already in use?)`);
  }
});
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
