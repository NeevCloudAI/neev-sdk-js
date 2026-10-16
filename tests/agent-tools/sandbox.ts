import { SandboxTools } from "../../src/agent-tools.js";
import { AuthenticationError } from "../../src/errors.js";
import type { Sandbox } from "../../src/sandbox.js";

// The fatal error a fake sandbox throws; its text carries ids that must never reach a model.
export const authError = () =>
  new AuthenticationError(401, { message: "invalid api key for /orgs/org-123" }, undefined);

// SandboxTools over a fake sandbox: run_command prints "hi", and reading "boom.txt" fails fatally.
export function fakeTools(options: ConstructorParameters<typeof SandboxTools>[1] = {}) {
  const calls: unknown[][] = [];
  const sandbox = {
    async exec(command: string, options: unknown) {
      calls.push(["exec", command, options]);
      return { exitCode: 0, stdout: "hi\n", stderr: "" };
    },
    files: {
      async read(path: string) {
        calls.push(["read", path]);
        if (path === "boom.txt") throw authError();
        return new TextEncoder().encode("content");
      },
    },
  };
  return { tools: new SandboxTools(sandbox as unknown as Sandbox, options), calls };
}

export const ALL = { allowPreview: true, allowRollback: true, allowProcesses: true };
