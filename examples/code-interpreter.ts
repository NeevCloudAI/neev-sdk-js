/**
 * Run Python in a sandbox's code interpreter, with state kept between runs.
 *
 * Creates a sandbox from the interpreter template, defines a variable in one run and
 * uses it in the next, shows that an exception comes back as a result rather than a
 * throw, then runs in a second context to show contexts do not share state.
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/code-interpreter.ts
 */
import { Neev } from "@neevcloud/sdk";

const neev = new Neev();

async function main(): Promise<void> {
  const sandbox = await neev.sandboxes.create({
    sandbox_template_id: "sb-ubuntu-26-04-interpreter",
  });

  try {
    await sandbox.code.run("x = 40");
    const sum = await sandbox.code.run("print(x + 2)\nx * 2", {
      onStdout: (out) => process.stdout.write(`stdout: ${out.line}`),
    });
    console.log("last value:", sum.text, "cell:", sum.executionCount, "ended:", sum.endReason);

    const failed = await sandbox.code.run("1 / 0");
    console.log("ended:", failed.endReason, "-", failed.error?.name, failed.error?.value);

    const ctx = await sandbox.code.createContext();
    const other = await sandbox.code.run("print('x' in globals())", { context: ctx });
    console.log("x visible in a new context:", other.stdout.trim());

    console.log("contexts:", await sandbox.code.listContexts());
  } finally {
    await sandbox.delete();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
