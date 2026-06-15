/**
 * Open an interactive PTY (pseudo-terminal) in a sandbox.
 *
 * `sandbox.pty.create` opens a terminal over a WebSocket: output streams to `onData`,
 * and you drive it with `sendInput` / `resize` / `kill`, awaiting `wait()` for the exit
 * code. This example runs a short shell session non-interactively (sends a command, prints
 * the output, then exits); a real TUI would instead pipe your terminal's stdin/stdout and
 * forward SIGWINCH to `resize`.
 *
 * The PTY needs a WebSocket that can send the auth header. In Node, install `ws`
 * (`pnpm add -D ws @types/ws`) and pass it to the client, as below.
 *
 * Run (targets the Neev production API by default; override with NEEV_BASE_URL):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/pty.ts
 */
import { Neev } from "@neevcloud/sdk";
import WebSocket from "ws";

// In Node, back the PTY WebSocket with `ws` so the bearer auth header is sent.
const neev = new Neev({ webSocket: (url, opts) => new WebSocket(url, opts) });

async function main(): Promise<void> {
  const sandbox = await neev.sandboxes.create({
    name: `pty-${Math.random().toString(36).slice(2, 8)}`,
    region: process.env.NEEV_REGION,
  });

  try {
    const decoder = new TextDecoder();
    const pty = await sandbox.pty.create({
      program: "sh",
      cols: 80,
      rows: 24,
      // Decode in streaming mode so a multibyte UTF-8 character split across
      // frames isn't corrupted; the trailing flush below emits any held bytes.
      onData: (chunk) => process.stdout.write(decoder.decode(chunk, { stream: true })),
    });

    // Drive the shell, then exit so the session ends cleanly.
    pty.sendInput("echo hello-from-pty && uname -a\n");
    pty.sendInput("exit\n");

    const { exitCode } = await pty.wait();
    // Flush any bytes the streaming decoder buffered from a partial sequence.
    process.stdout.write(decoder.decode());
    console.error(`\n[pty exited with code ${exitCode}]`);
  } finally {
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
