/**
 * Fan out work across several isolated sandboxes, then read their metrics.
 *
 * Provisions N strongly isolated sandboxes concurrently, runs an independent piece
 * of a map/reduce (each sums a slice of 1..3000) in each, reduces the partials,
 * reads each sandbox's live metric series, and tears them all down. Demonstrates
 * isolation, concurrent lifecycle, exec, and `sandbox.metrics()` — no LLM.
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/parallel-fanout.ts
 */
import { Neev, type Sandbox } from "@neevcloud/sdk";

const neev = new Neev();

const TEMPLATE = "sb-ubuntu-26-04-minimal";
// Split the range [1, TOTAL] into SHARDS contiguous slices, one per sandbox.
const TOTAL = 3000;
const SHARDS = 3;

// Writes a progress line to stderr so stdout carries only the final result.
function log(message: string): void {
  console.error(`[fanout] ${message}`);
}

// Sums the inclusive integer range [from, to] inside one sandbox using POSIX sh
// arithmetic (no dependency on bc/awk, so it runs on the minimal template).
async function sumRange(sandbox: Sandbox, from: number, to: number): Promise<number> {
  const script = `s=0; i=${from}; while [ $i -le ${to} ]; do s=$((s+i)); i=$((i+1)); done; echo $s`;
  const result = await sandbox.exec(["sh", "-c", script]);
  if (result.exitCode !== 0) throw new Error(`shard [${from},${to}] failed: ${result.stderr}`);
  return Number.parseInt(result.stdout.trim(), 10);
}

async function main(): Promise<void> {
  // Contiguous, non-overlapping slices covering [1, TOTAL].
  const size = Math.ceil(TOTAL / SHARDS);
  const slices = Array.from({ length: SHARDS }, (_, i) => ({
    from: i * size + 1,
    to: Math.min((i + 1) * size, TOTAL),
  }));

  // Provision one sandbox per slice, concurrently.
  log(`provisioning ${SHARDS} sandboxes (${TEMPLATE})…`);
  const sandboxes = await Promise.all(
    slices.map((_, i) =>
      neev.sandboxes.create({
        sandbox_template_id: TEMPLATE,
      }),
    ),
  );

  try {
    // Map: each sandbox sums its slice (exec auto-waits until Ready).
    log("running shards…");
    const partials = await Promise.all(
      sandboxes.map((sandbox, i) => sumRange(sandbox, slices[i].from, slices[i].to)),
    );
    slices.forEach((s, i) => log(`shard [${s.from}, ${s.to}] -> ${partials[i]}`));

    // Reduce: combine the partial sums.
    const total = partials.reduce((a, b) => a + b, 0);

    // Read each sandbox's live metric series.
    log("reading metrics…");
    const metrics = await Promise.all(sandboxes.map((sandbox) => sandbox.metrics()));
    metrics.forEach((m, i) => {
      const series = m.series.map((s) => `${s.metric}(${s.points.length}pts)`).join(", ");
      log(`sandbox ${i} metrics: ${series || "(none yet)"}`);
    });

    console.log(`sum(1..${TOTAL}) across ${SHARDS} sandboxes = ${total}`);
  } finally {
    // Tear all sandboxes down concurrently.
    log("deleting sandboxes…");
    await Promise.all(sandboxes.map((sandbox) => sandbox.delete().catch(() => undefined)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
