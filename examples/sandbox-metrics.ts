/**
 * Read live metrics from a sandbox under load.
 *
 * Provisions one sandbox, drives CPU in short bursts, and polls
 * `sandbox.metrics()` after each burst so you can watch the tenant-scoped metric
 * series (CPU / memory / disk) fill in over time, then tears it down. No LLM.
 *
 * Metrics are sampled server-side, so a brand-new sandbox reports empty series
 * until the first samples land — this example keeps load running and re-reads
 * until points appear (or the bursts run out). The values and resolution depend
 * on the environment's metrics pipeline; some collectors (e.g. cpu/memory in a
 * non-production environment) may report zero while disk usage is populated.
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/sandbox-metrics.ts
 */
import { Neev, type Sandbox, type SandboxMetricsResponse } from "@neevcloud/sdk";

const neev = new Neev();

// Production region; override with NEEV_REGION for another environment.
const REGION = process.env.NEEV_REGION ?? "as-south-1";
const TEMPLATE = "sb-ubuntu-26-04-minimal";
// Drive load in BURSTS slices of BURST_SECONDS each, reading metrics between them.
const BURSTS = 8;
const BURST_SECONDS = 15;

// Writes a progress line to stderr so stdout carries only the final summary.
function log(message: string): void {
  console.error(`[metrics] ${message}`);
}

// Burns CPU for `seconds` with a POSIX-sh busy loop (runs on the minimal template,
// which has no stress tool). exec blocks until the loop ends.
async function burn(sandbox: Sandbox, seconds: number): Promise<void> {
  const script = `end=$(( $(date +%s) + ${seconds} )); while [ $(date +%s) -lt $end ]; do :; done`;
  await sandbox.exec(["sh", "-c", script], { timeoutMs: (seconds + 10) * 1000 });
}

// One-line view of every series with its latest value and point count.
function summarize(metrics: SandboxMetricsResponse): string {
  return metrics.series
    .map((s) => {
      const last = s.points.at(-1);
      const value = last ? Number(last[1]).toPrecision(3) : "—";
      return `${s.metric}=${value}${s.unit ? ` ${s.unit}` : ""}(${s.points.length}pts)`;
    })
    .join("  ");
}

async function main(): Promise<void> {
  log(`creating sandbox (${TEMPLATE}, ${REGION})…`);
  const sandbox = await neev.sandboxes.create({
    name: `metrics-${Math.random().toString(36).slice(2, 8)}`,
    sandbox_template_id: TEMPLATE,
    region: REGION,
  });

  try {
    await sandbox.waitUntilReady();
    log(`ready: ${sandbox.id}`);

    // Drive load and re-read metrics until the series carry samples.
    for (let i = 1; i <= BURSTS; i++) {
      await burn(sandbox, BURST_SECONDS);
      const m = await sandbox.metrics();
      log(`burst ${i}/${BURSTS}: ${summarize(m)}`);
      if (m.series.some((s) => s.points.length > 0) && i >= 3) break;
    }

    // Final detailed readout.
    const metrics = await sandbox.metrics();
    console.log(`metrics for sandbox ${sandbox.id} (${metrics.from} -> ${metrics.to}):`);
    for (const s of metrics.series) {
      const last = s.points.at(-1);
      const tail = last ? `, last=${Number(last[1])}${s.unit ? ` ${s.unit}` : ""}` : "";
      console.log(`  ${s.metric}: ${s.points.length} points${tail}`);
    }
  } finally {
    log(`deleting sandbox ${sandbox.id}`);
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
