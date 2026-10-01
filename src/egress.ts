import { NeevError } from "./errors.js";
import type { EgressConvenience, SandboxEgressConfig, SandboxEgressRule } from "./types.js";

// buildEgress maps the allowInternet/allowEgress convenience to a SandboxEgressConfig.
// allowInternet emits BOTH the allow_internet gate AND explicit 0.0.0.0/0 + ::/0 routes,
// since the gate alone is a server-side no-op — the routes are what actually open egress.
// Returns undefined when neither is set, so the platform/template default applies.
export function buildEgress(
  allowInternet?: boolean,
  allow?: string[],
): SandboxEgressConfig | undefined {
  if (!allowInternet && (allow === undefined || allow.length === 0)) return undefined;
  const rules: SandboxEgressRule[] = [];
  if (allowInternet) rules.push({ host: "0.0.0.0/0" }, { host: "::/0" });
  for (const host of allow ?? []) rules.push({ host });
  return { mode: "allow_list", allow_internet: allowInternet === true, allow: rules };
}

// withEgressConvenience strips the SDK-only allowInternet/allowEgress fields from create
// params and, when the caller passed no explicit `egress`, translates them into the
// egress policy. An explicit `egress` always wins. Shared by sandbox and agent create.
export function withEgressConvenience<T extends { egress?: SandboxEgressConfig | null }>(
  params: T & EgressConvenience,
): T {
  const { allowInternet, allowEgress, ...rest } = params;
  const body = rest as T;
  if (body.egress === undefined) {
    const egress = buildEgress(allowInternet, allowEgress);
    if (egress) body.egress = egress;
  }
  return body;
}

// assertUpdateBody rejects an in-place update that sets none of `fields`, or that mixes
// a full `egress` replacement with an `egress_add` / `egress_remove` edit (the server
// refuses both). Shared by sandbox and agent update; `method` prefixes the error.
export function assertUpdateBody(body: object, method: string, fields: readonly string[]): void {
  const set = body as Record<string, unknown>;
  const edits = set.egress_add !== undefined || set.egress_remove !== undefined;
  if (set.egress !== undefined && edits) {
    throw new NeevError(
      `${method}: \`egress\` replaces the policy in full and cannot be combined with \`egress_add\` / \`egress_remove\` (or \`allowInternet\` / \`allowEgress\`).`,
    );
  }
  if (fields.every((field) => set[field] === undefined)) {
    const names = fields.map((field) => `\`${field}\``);
    throw new NeevError(
      `${method} requires at least one of ${names.slice(0, -1).join(", ")} or ${names.at(-1)}.`,
    );
  }
}
