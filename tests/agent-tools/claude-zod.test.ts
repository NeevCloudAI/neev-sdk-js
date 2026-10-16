import { describe, expect, it, vi } from "vitest";
import { toClaude } from "../../src/agent-tools/claude.js";
import { NeevError } from "../../src/errors.js";
import { fakeTools } from "./sandbox.js";

// zod before 4.2 has no fromJSONSchema.
vi.mock("zod", () => ({ z: {} }));

describe("toClaude on an older zod", () => {
  it("throws a NeevError naming the zod it needs", () => {
    expect(() => toClaude(fakeTools().tools)).toThrow(NeevError);
    expect(() => toClaude(fakeTools().tools)).toThrow("toClaude needs zod 4.2 or later.");
  });
});
