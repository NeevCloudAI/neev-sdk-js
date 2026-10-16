// NeevCloud sandbox tools for agents, independent of any agent framework. Each
// tool resolves to a plain object for the model to read. Failures the model can
// act on resolve to { error }; auth, permission, rate-limit, server and network
// failures throw, because no next tool call can fix them. A process start the
// sandbox refuses as resource_exhausted resolves to { error } too, since a retry
// or stopping a process is the model's next move.

import {
  APIConnectionError,
  APIError,
  BadRequestError,
  ConflictError,
  DeadlineExceededError,
  NeevError,
  NotFoundError,
  RateLimitError,
  apiErrorReasonCode,
} from "./errors.js";
import type { ProcessState } from "./processes.js";
import type { Sandbox } from "./sandbox.js";
import { errorText, shortError } from "./tool-text.js";

// Per-stream cap: keep the start (what ran) and the end (how it ended).
const MAX_OUTPUT_BYTES = 10_000;
const HEAD_BYTES = 4_000;
const TAIL_BYTES = 6_000;

const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 600;
const MAX_WAIT_S = 60;
const CHECKPOINT_TIMEOUT_S = 300;

const TIMEOUT_ERROR = "timed out";
const SILENT_CUT_ERROR =
  "the command printed nothing for about 2 minutes and the connection was cut; it may still be running. Use start_process for long or quiet commands";

/** Name of a tool in the sandbox tool contract, as the model sees it. */
export type ToolName =
  | "run_command"
  | "write_file"
  | "read_file"
  | "expose_port"
  | "checkpoint"
  | "rollback"
  | "start_process"
  | "read_process_output"
  | "stop_process"
  | "stat_path"
  | "move_path"
  | "delete_path"
  | "list_processes";

/** Model-facing description of each tool, identical across the NeevCloud SDKs. */
export const DESCRIPTIONS: Readonly<Record<ToolName, string>> = Object.freeze({
  run_command:
    "Run a shell command in the sandbox with sh -lc and return exit_code, stdout and stderr. " +
    "State persists between calls. " +
    "Output over 10 KB is cut in the middle. " +
    "A non-zero exit_code is a normal result: read stderr and try again. " +
    "A command that prints nothing for about 2 minutes is cut off by the network, so run long or quiet work with start_process if you have it.",
  write_file:
    "Write a UTF-8 text file in the sandbox. " +
    "path is relative to /workspace, or absolute inside /workspace.",
  read_file:
    "Read a UTF-8 text file from the sandbox. " +
    "path is relative to /workspace, or absolute inside /workspace. " +
    "Without offset or length, content over 10 KB is cut in the middle. " +
    "To read a large file in full, pass offset (bytes, default 0) and length (bytes, 1 to 10000) and keep reading from the returned next_offset until eof is true.",
  expose_port:
    "Make a server listening on this port in the sandbox reachable at a public HTTPS preview URL, and return it. " +
    "Anyone with the URL can open it without logging in.",
  checkpoint:
    "Save the sandbox's full state and return a checkpoint_id. " + "Take one before a risky step.",
  rollback:
    "Roll the sandbox back to a checkpoint_id from checkpoint. " +
    "Every change since that checkpoint is lost.",
  start_process:
    "Start a shell command in the background with sh -lc and return its process_id at once. " +
    "Use it for servers, builds and anything that may outlast a run_command. " +
    "A process left running is killed after an hour. " +
    "A resource_exhausted error means the sandbox is at its limit of processes or in-flight requests: stop a process you no longer need, or retry shortly.",
  read_process_output:
    "Read a background process's new stdout and stderr since cursor; " +
    "pass the returned cursor to the next call. " +
    "state is running or exited, with exit_code once exited. " +
    "Output over 10 KB per stream is cut in the middle, and the returned cursor still moves past the cut part. " +
    "dropped: true means output was overwritten because the buffer keeps about 1 MB, so read more often. " +
    "wait_s (0 to 60, default 0) first waits up to that many seconds for a running process to exit, which saves turns while following a long command. " +
    "An exited process's status is kept for about 10 minutes, after which exit_code is no longer returned.",
  stop_process:
    "Stop a background process by sending it SIGTERM. " +
    "ok is false if it had already exited. " +
    "An exited process's status is kept for about 10 minutes.",
  stat_path:
    "Report whether a path exists in the sandbox and, when it does, its type (file, directory or symlink), size in bytes and modification time. " +
    "path is relative to /workspace, or absolute inside /workspace. " +
    "A missing path is exists: false, not an error.",
  move_path:
    "Move or rename a file or directory in the sandbox, creating the destination's parent directories. " +
    "Both paths are relative to /workspace, or absolute inside /workspace. " +
    "An existing file at the destination is replaced; an existing directory there is an error.",
  delete_path:
    "Delete a file or directory in the sandbox. " +
    "A directory that is not empty is deleted only with recursive: true. " +
    "A missing path is an error. " +
    "Deletion cannot be undone, so take a checkpoint first if you have it and may need the files back.",
  list_processes:
    "List the background processes started in this sandbox, each with its process_id, command, state and exit_code once exited. " +
    "Use it to find a process_id you no longer have. " +
    "An exited process is listed for about 10 minutes.",
});

/** Short human-readable title of each tool, identical across the NeevCloud SDKs. */
export const TITLES: Readonly<Record<ToolName, string>> = Object.freeze({
  run_command: "Run a command",
  write_file: "Write a file",
  read_file: "Read a file",
  expose_port: "Expose a port",
  checkpoint: "Save a checkpoint",
  rollback: "Roll back to a checkpoint",
  start_process: "Start a background process",
  read_process_output: "Read a process's output",
  stop_process: "Stop a process",
  stat_path: "Check a path",
  move_path: "Move or rename a path",
  delete_path: "Delete a file or directory",
  list_processes: "List processes",
});

/** A JSON Schema object, as found in {@link PARAMETERS}. */
type ToolJsonSchema = { readonly [key: string]: unknown };

/**
 * JSON Schema of each tool's arguments, identical across the NeevCloud SDKs.
 * Pair it with {@link DESCRIPTIONS} to declare the tools to a model.
 */
export const PARAMETERS: Readonly<Record<ToolName, ToolJsonSchema>> = deepFreeze({
  run_command: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command, run with sh -lc.",
      },
      cwd: {
        type: "string",
        description:
          "Working directory, relative to /workspace or absolute inside /workspace. Default /workspace.",
      },
      timeout_s: {
        type: "number",
        description: "Seconds to wait for the command to finish, 1 to 600. Default 60.",
        minimum: 1,
        maximum: 600,
        default: 60,
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  write_file: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path, relative to /workspace or absolute inside /workspace.",
      },
      content: {
        type: "string",
        description: "UTF-8 text to write.",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  read_file: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path, relative to /workspace or absolute inside /workspace.",
      },
      offset: {
        type: "integer",
        description: "Byte to start reading at. Default 0.",
        minimum: 0,
      },
      length: {
        type: "integer",
        description: "Bytes to read, 1 to 10000. Default 10000 when offset is given.",
        minimum: 1,
        maximum: 10000,
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  expose_port: {
    type: "object",
    properties: {
      port: {
        type: "integer",
        description: "Port the server listens on inside the sandbox.",
        minimum: 1,
        maximum: 65535,
      },
    },
    required: ["port"],
    additionalProperties: false,
  },
  checkpoint: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "Optional name for the checkpoint.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  rollback: {
    type: "object",
    properties: {
      checkpoint_id: {
        type: "string",
        description: "checkpoint_id returned by checkpoint.",
      },
    },
    required: ["checkpoint_id"],
    additionalProperties: false,
  },
  start_process: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command, run with sh -lc.",
      },
      cwd: {
        type: "string",
        description:
          "Working directory, relative to /workspace or absolute inside /workspace. Default /workspace.",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  read_process_output: {
    type: "object",
    properties: {
      process_id: {
        type: "string",
        description: "process_id returned by start_process.",
      },
      cursor: {
        type: "integer",
        description:
          "cursor returned by the previous read. Omit to read from the oldest output kept.",
        minimum: 0,
      },
      wait_s: {
        type: "number",
        description:
          "Seconds to wait for a running process to exit before reading, 0 to 60. Default 0.",
        minimum: 0,
        maximum: 60,
        default: 0,
      },
    },
    required: ["process_id"],
    additionalProperties: false,
  },
  stop_process: {
    type: "object",
    properties: {
      process_id: {
        type: "string",
        description: "process_id returned by start_process.",
      },
    },
    required: ["process_id"],
    additionalProperties: false,
  },
  stat_path: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path, relative to /workspace or absolute inside /workspace.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  move_path: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "Path to move, relative to /workspace or absolute inside /workspace.",
      },
      destination: {
        type: "string",
        description: "New path, relative to /workspace or absolute inside /workspace.",
      },
    },
    required: ["source", "destination"],
    additionalProperties: false,
  },
  delete_path: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to delete, relative to /workspace or absolute inside /workspace.",
      },
      recursive: {
        type: "boolean",
        description: "Delete a non-empty directory and everything in it. Default false.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  list_processes: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
});

/** Result of a tool call the model can recover from with a different next call. */
export interface ToolErrorResult {
  error: string;
}

/** Arguments of run_command. */
export interface RunCommandToolArgs {
  command: string;
  /** Working directory, relative to /workspace or absolute inside it. */
  cwd?: string | null;
  /** Seconds before the command is abandoned; clamped to 1–600, default 60. Numeric strings are accepted. */
  timeout_s?: number | string | null;
}

/** Result of run_command; a non-zero exit_code is a result, not an error. */
export interface RunCommandToolResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

/** Arguments of write_file. */
export interface WriteFileToolArgs {
  /** Relative to /workspace, or absolute inside it. */
  path: string;
  content: string;
}

/** Result of write_file. */
export interface WriteFileToolResult {
  bytes_written: number;
}

/** Arguments of read_file; offset or length makes it a paged read. */
export interface ReadFileToolArgs {
  /** Relative to /workspace, or absolute inside it. */
  path: string;
  /** Byte to start reading at; default 0. Numeric strings are accepted. */
  offset?: number | string | null;
  /** Bytes to read; clamped to 1–10000, default 10000. Numeric strings are accepted. */
  length?: number | string | null;
}

/**
 * Result of read_file. Unpaged, content over 10 KB is cut in the middle; paged,
 * next_offset is where the next read starts and eof is true once nothing follows.
 */
export interface ReadFileToolResult {
  content: string;
  next_offset?: number;
  eof?: boolean;
}

/** Arguments of expose_port. */
export interface ExposePortToolArgs {
  /** Port a server listens on in the sandbox. Numeric strings are accepted. */
  port: number | string;
}

/** Result of expose_port. */
export interface ExposePortToolResult {
  preview_url: string;
}

/** Arguments of checkpoint. */
export interface CheckpointToolArgs {
  /** Name given to the snapshot behind the checkpoint. */
  label?: string | null;
}

/** Result of checkpoint. */
export interface CheckpointToolResult {
  checkpoint_id: string;
}

/** Arguments of rollback. */
export interface RollbackToolArgs {
  checkpoint_id: string;
}

/** Result of rollback. */
export interface RollbackToolResult {
  ok: true;
}

/** Arguments of start_process. */
export interface StartProcessToolArgs {
  command: string;
  /** Working directory, relative to /workspace or absolute inside it. */
  cwd?: string | null;
}

/** Result of start_process. */
export interface StartProcessToolResult {
  process_id: string;
}

/** Arguments of read_process_output. */
export interface ReadProcessOutputToolArgs {
  process_id: string;
  /** Byte offset returned by the previous read; omit to read from the oldest retained byte. */
  cursor?: number | string | null;
  /**
   * Seconds to wait for a running process to exit before reading; clamped to
   * 0–60, default 0. Numeric strings are accepted.
   */
  wait_s?: number | string | null;
}

/** Result of read_process_output; exit_code is absent while running or once the status has expired. */
export interface ReadProcessOutputToolResult {
  stdout: string;
  stderr: string;
  cursor: number;
  state: ProcessState;
  dropped: boolean;
  exit_code?: number | null;
}

/** Arguments of stop_process. */
export interface StopProcessToolArgs {
  process_id: string;
}

/** Result of stop_process; ok is false when the process had already exited. */
export interface StopProcessToolResult {
  ok: boolean;
}

/** Arguments of stat_path. */
export interface StatPathToolArgs {
  /** Relative to /workspace, or absolute inside it. */
  path: string;
}

/** Result of stat_path; a missing path is exists: false. */
export type StatPathToolResult =
  | { exists: false }
  | {
      exists: true;
      type: "file" | "directory" | "symlink";
      size: number;
      modified_time: string;
    };

/** Arguments of move_path. */
export interface MovePathToolArgs {
  /** Relative to /workspace, or absolute inside it. */
  source: string;
  /** Relative to /workspace, or absolute inside it. */
  destination: string;
}

/** Result of move_path. */
export interface MovePathToolResult {
  ok: true;
}

/** Arguments of delete_path. */
export interface DeletePathToolArgs {
  /** Relative to /workspace, or absolute inside it. */
  path: string;
  /** Delete a non-empty directory and everything in it; default false. */
  recursive?: boolean | null;
}

/** Result of delete_path. */
export interface DeletePathToolResult {
  ok: true;
}

/** Arguments of list_processes, which takes none. */
export type ListProcessesToolArgs = Record<string, never>;

/** One process in list_processes; exit_code is present only once it has exited. */
export interface ListedProcess {
  process_id: string;
  command: string;
  state: ProcessState;
  exit_code?: number | null;
}

/** Result of list_processes. */
export interface ListProcessesToolResult {
  processes: ListedProcess[];
}

/** Any result a tool can resolve to. */
export type ToolResult =
  | ToolErrorResult
  | RunCommandToolResult
  | WriteFileToolResult
  | ReadFileToolResult
  | ExposePortToolResult
  | CheckpointToolResult
  | RollbackToolResult
  | StartProcessToolResult
  | ReadProcessOutputToolResult
  | StopProcessToolResult
  | StatPathToolResult
  | MovePathToolResult
  | DeletePathToolResult
  | ListProcessesToolResult;

/** Options of SandboxTools; every opt-in tool is off unless enabled. */
interface SandboxToolsOptions {
  /** Enable expose_port, which makes a sandbox port public. */
  allowPreview?: boolean;
  /** Enable checkpoint and rollback. */
  allowRollback?: boolean;
  /** Enable start_process, read_process_output, stop_process and list_processes. */
  allowProcesses?: boolean;
}

// The parts of a Sandbox handle the tools call. Kept internal so it can grow
// with the tools; a Sandbox always satisfies it.
type ToolSandbox = {
  exec: (...args: Parameters<Sandbox["exec"]>) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  getUrl: (...args: Parameters<Sandbox["getUrl"]>) => Promise<string>;
  snapshot: (...args: Parameters<Sandbox["snapshot"]>) => Promise<{ id: string }>;
  rollback: (snapshotId: string) => Promise<unknown>;
  files: Pick<Sandbox["files"], "write" | "read" | "stat" | "move" | "remove">;
  processes: Pick<Sandbox["processes"], "start" | "logs" | "get" | "kill" | "list">;
};

// Raised inside a tool when the model's arguments are missing or malformed.
class InvalidArguments extends Error {}

// Freezes value and everything inside it.
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

// Returns text unchanged up to MAX_OUTPUT_BYTES, else its head and tail around a marker.
function truncate(text: string): string {
  const data = new TextEncoder().encode(text);
  if (data.length <= MAX_OUTPUT_BYTES) return text;
  const dropped = data.length - HEAD_BYTES - TAIL_BYTES;
  // ignoreBOM keeps a leading U+FEFF, as the untruncated text does.
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const head = decoder.decode(data.subarray(0, HEAD_BYTES));
  const tail = decoder.decode(data.subarray(data.length - TAIL_BYTES));
  return `${head}\n…[${dropped} bytes truncated]…\n${tail}`;
}

// A plain decimal with ASCII digits, optionally wrapped in ASCII whitespace,
// as the Python SDK reads it: no hex, no "Infinity", no underscores, no BOM.
const NUMERIC = /^[ \t\n\r\f\v]*[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?[ \t\n\r\f\v]*$/;

// Returns value as a finite number, or undefined when it is not one (booleans,
// NaN, ±Infinity, null and non-numeric strings included).
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && NUMERIC.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// Converts seconds to whole milliseconds, rounding half up the way the Python SDK does.
function toMs(seconds: number): number {
  return Math.floor(seconds * 1000 + 0.5);
}

// Clamps value to [min, max]; anything that is not a finite number takes the default.
function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(Math.max(toNumber(value) ?? fallback, min), max);
}

// Returns args[key] as a string; asRecord has already checked its type.
function requireString(args: Record<string, unknown>, key: string): string {
  return args[key] as string;
}

// Returns args[key] as a string, or undefined when absent; asRecord has already checked its type.
function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  return (args[key] ?? undefined) as string | undefined;
}

// Returns a tool's arguments as a record after checking them against its
// PARAMETERS, or throws InvalidArguments with the Python SDK's reasons, in its
// order: an object; no argument the schema does not name (own keys only, so
// "constructor" or "__proto__" is unexpected); every required argument present;
// then, in schema order, a string where one is due and null only for optional
// arguments. Numbers and booleans are checked when required, or for every one
// when strict (as call() does); otherwise an optional one that is not one
// takes its default.
function asRecord(name: ToolName, args: unknown, strict = false): Record<string, unknown> {
  const value = args ?? {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidArguments("expected an object");
  }
  const record = value as Record<string, unknown>;
  const schema = PARAMETERS[name] as {
    properties: Record<string, { type: string }>;
    required: readonly string[];
  };
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(schema.properties, key)) {
      throw new InvalidArguments(`got an unexpected keyword argument ${JSON.stringify(key)}`);
    }
  }
  for (const key of schema.required) {
    if (record[key] === undefined) {
      throw new InvalidArguments(`missing a required argument: ${JSON.stringify(key)}`);
    }
  }
  for (const [field, prop] of Object.entries(schema.properties)) {
    const v = record[field];
    const required = schema.required.includes(field);
    if (v === undefined || (v === null && !required)) continue;
    if (prop.type === "string") {
      if (typeof v !== "string") throw new InvalidArguments(`${field} must be string`);
    } else if (prop.type === "boolean") {
      if ((strict || required) && typeof v !== "boolean")
        throw new InvalidArguments(`${field} must be boolean`);
    } else if (strict || required) {
      const n = toNumber(v);
      if (n === undefined || (prop.type === "integer" && !Number.isInteger(n))) {
        throw new InvalidArguments(`${field} must be ${prop.type}`);
      }
    }
  }
  return record;
}

// True for a UTF-8 continuation byte (10xxxxxx).
function isContinuation(byte = 0): boolean {
  return (byte & 0xc0) === 0x80;
}

// Bytes in the UTF-8 sequence a lead byte starts; 1 for an invalid lead, so decoding rejects it.
function sequenceLength(lead = 0): number {
  if (lead >= 0xf8) return 1;
  if (lead >= 0xf0) return 4;
  if (lead >= 0xe0) return 3;
  if (lead >= 0xc0) return 2;
  return 1;
}

// Like asRecord, but never throws; for reading a default before validation runs.
function asRecordOrEmpty(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

// True for errors the model can fix with a different next call. A NeevError that
// is neither an APIError nor a connection error is a client-side failure, such as
// a preview URL that did not become routable in time.
function recoverable(err: unknown): err is NeevError {
  if (
    err instanceof BadRequestError ||
    err instanceof NotFoundError ||
    err instanceof ConflictError ||
    err instanceof DeadlineExceededError
  ) {
    return true;
  }
  return (
    err instanceof NeevError && !(err instanceof APIError) && !(err instanceof APIConnectionError)
  );
}

// Runs fn, turning errors the model can act on into a short error result.
async function recover<T>(
  name: ToolName,
  fn: () => Promise<T>,
  timeoutError = TIMEOUT_ERROR,
): Promise<T | ToolErrorResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InvalidArguments) {
      return { error: shortError(`invalid arguments for ${name}: ${err.message}`) };
    }
    // The 504 body is often a proxy's HTML page, so say what happened instead.
    if (err instanceof DeadlineExceededError) return { error: timeoutError };
    if (recoverable(err)) return { error: shortError(errorText(err)) };
    throw err;
  }
}

// Returns the error result for an opt-in tool that is not enabled.
function disabled(name: ToolName): ToolErrorResult {
  return { error: `${name} is not enabled for this agent` };
}

// sandbox.snapshot's own wait errors, mapped to the checkpoint wording below.
const SNAPSHOT_FAILED = /^Snapshot (\S+) failed to capture(?:: (.*))?\.$/s;
const SNAPSHOT_NOT_READY = /^Snapshot (\S+) was not Ready within /;

// Rewords a snapshot wait failure as a checkpoint error, or returns undefined.
function checkpointError(err: unknown): ToolErrorResult | undefined {
  if (!(err instanceof NeevError) || err instanceof APIError) return undefined;
  const failed = SNAPSHOT_FAILED.exec(err.message);
  if (failed) {
    const reason = failed[2] ? `: ${failed[2]}` : "";
    return { error: shortError(`checkpoint ${failed[1]} failed${reason}`) };
  }
  const late = SNAPSHOT_NOT_READY.exec(err.message);
  if (late) return { error: `checkpoint ${late[1]} not ready after ${CHECKPOINT_TIMEOUT_S} s` };
  return undefined;
}

/**
 * The sandbox tool contract bound to one sandbox, for any agent framework.
 * Declare {@link SandboxTools.names} to the model with {@link DESCRIPTIONS} and
 * {@link PARAMETERS}, and pass each tool call to {@link SandboxTools.call}. Opt-in
 * tools stay off unless enabled. Methods are bound, so they can be passed around
 * on their own.
 */
export class SandboxTools {
  private readonly sandbox: ToolSandbox;
  private readonly allowPreview: boolean;
  private readonly allowRollback: boolean;
  private readonly allowProcesses: boolean;

  constructor(sandbox: Sandbox, options: SandboxToolsOptions = {}) {
    this.sandbox = sandbox;
    this.allowPreview = options.allowPreview ?? false;
    this.allowRollback = options.allowRollback ?? false;
    this.allowProcesses = options.allowProcesses ?? false;
    // Frameworks take tool functions on their own, detached from the instance.
    this.names = this.names.bind(this);
    this.call = this.call.bind(this);
    this.runCommand = this.runCommand.bind(this);
    this.writeFile = this.writeFile.bind(this);
    this.readFile = this.readFile.bind(this);
    this.exposePort = this.exposePort.bind(this);
    this.checkpoint = this.checkpoint.bind(this);
    this.rollback = this.rollback.bind(this);
    this.startProcess = this.startProcess.bind(this);
    this.readProcessOutput = this.readProcessOutput.bind(this);
    this.stopProcess = this.stopProcess.bind(this);
    this.statPath = this.statPath.bind(this);
    this.movePath = this.movePath.bind(this);
    this.deletePath = this.deletePath.bind(this);
    this.listProcesses = this.listProcesses.bind(this);
  }

  /** Returns the enabled tools to declare to the model, in contract order. */
  names(): ToolName[] {
    const names: ToolName[] = [
      "run_command",
      "write_file",
      "read_file",
      "stat_path",
      "move_path",
      "delete_path",
    ];
    if (this.allowPreview) names.push("expose_port");
    if (this.allowRollback) names.push("checkpoint", "rollback");
    if (this.allowProcesses) {
      names.push("start_process", "read_process_output", "stop_process", "list_processes");
    }
    return names;
  }

  /**
   * Runs the tool the model called by its contract name with the model's
   * arguments. An unknown name, a disabled tool, or missing or malformed
   * arguments resolve to an error result.
   */
  call(name: string, args: unknown): Promise<ToolResult> {
    if (!Object.hasOwn(DESCRIPTIONS, name)) {
      return Promise.resolve({ error: shortError(`unknown tool: ${String(name)}`) });
    }
    const tool = name as ToolName;
    if (!this.names().includes(tool)) return Promise.resolve(disabled(tool));
    try {
      // Model input never makes call() throw: numbers are checked strictly here.
      asRecord(tool, args, true);
    } catch (err) {
      if (!(err instanceof InvalidArguments)) throw err;
      return Promise.resolve({
        error: shortError(`invalid arguments for ${tool}: ${err.message}`),
      });
    }
    const a = args as never;
    switch (tool) {
      case "run_command":
        return this.runCommand(a);
      case "write_file":
        return this.writeFile(a);
      case "read_file":
        return this.readFile(a);
      case "expose_port":
        return this.exposePort(a);
      case "checkpoint":
        return this.checkpoint(a);
      case "rollback":
        return this.rollback(a);
      case "start_process":
        return this.startProcess(a);
      case "read_process_output":
        return this.readProcessOutput(a);
      case "stop_process":
        return this.stopProcess(a);
      case "stat_path":
        return this.statPath(a);
      case "move_path":
        return this.movePath(a);
      case "delete_path":
        return this.deletePath(a);
      case "list_processes":
        return this.listProcesses(a);
    }
  }

  /** Runs a command with sh -lc; a non-zero exit is a result, not an error. timeout_s is clamped to 1–600 (default 60). */
  async runCommand(args: RunCommandToolArgs): Promise<RunCommandToolResult | ToolErrorResult> {
    const raw = args as unknown;
    const timeout = clamp(asRecordOrEmpty(raw).timeout_s, DEFAULT_TIMEOUT_S, 1, MAX_TIMEOUT_S);
    return recover(
      "run_command",
      async () => {
        const a = asRecord("run_command", raw);
        const command = requireString(a, "command");
        const cwd = optionalString(a, "cwd");
        let r: { exitCode: number; stdout: string; stderr: string };
        try {
          r = await this.sandbox.exec("sh", {
            args: ["-lc", command],
            cwd,
            timeoutMs: toMs(timeout),
          });
        } catch (err) {
          // The network edge answers 524 when a response stays silent for about
          // 2 minutes; the command may still be running, and start_process is the fix.
          if (err instanceof APIError && err.status === 524) return { error: SILENT_CUT_ERROR };
          throw err;
        }
        return { exit_code: r.exitCode, stdout: truncate(r.stdout), stderr: truncate(r.stderr) };
      },
      `command did not finish within ${timeout} s`,
    );
  }

  /** Writes a UTF-8 text file and reports the bytes written. */
  async writeFile(args: WriteFileToolArgs): Promise<WriteFileToolResult | ToolErrorResult> {
    return recover("write_file", async () => {
      const a = asRecord("write_file", args);
      const path = requireString(a, "path");
      const content = requireString(a, "content");
      return { bytes_written: (await this.sandbox.files.write(path, content)).bytesWritten };
    });
  }

  /**
   * Reads a UTF-8 text file, cut in the middle past 10 KB; a file that is not
   * UTF-8 is an error result. offset or length reads one page of up to 10000
   * bytes instead, trimmed to whole characters.
   */
  async readFile(args: ReadFileToolArgs): Promise<ReadFileToolResult | ToolErrorResult> {
    return recover("read_file", async () => {
      const a = asRecord("read_file", args);
      const path = requireString(a, "path");
      if (a.offset != null || a.length != null) return this.readPage(path, a.offset, a.length);
      const bytes = await this.sandbox.files.read(path);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch (err) {
        return { error: "not UTF-8 text" };
      }
      return { content: truncate(text) };
    });
  }

  // Reads one page of a file, trimmed to whole characters, without a second call to learn eof.
  private async readPage(
    path: string,
    rawOffset: unknown,
    rawLength: unknown,
  ): Promise<ReadFileToolResult | ToolErrorResult> {
    const offset = Math.floor(Math.max(toNumber(rawOffset) ?? 0, 0));
    const length = Math.floor(clamp(rawLength, MAX_OUTPUT_BYTES, 1, MAX_OUTPUT_BYTES));
    // 7 spare bytes: 3 for a leading skip, 3 to finish a character, 1 to see eof.
    const bytes = await this.sandbox.files.read(path, { offset, length: length + 7 });
    // An offset the model chose may land inside a character, which is at most 3 bytes in.
    let start = 0;
    while (start < 3 && start < bytes.length && isContinuation(bytes[start])) start++;
    if (start < bytes.length && isContinuation(bytes[start])) return { error: "not UTF-8 text" };
    let end = Math.max(Math.min(bytes.length, length), start);
    // Back off a character the window cuts; one cut by the real end of file stays and fails decoding.
    if (bytes.length > end) {
      let lead = end - 1;
      while (lead >= start && isContinuation(bytes[lead])) lead--;
      if (lead >= start && lead + sequenceLength(bytes[lead]) > end) end = lead;
    }
    // A window too short for one whole character takes the next one, so paging never stalls.
    if (end <= start && start < bytes.length) {
      end = Math.min(start + sequenceLength(bytes[start]), bytes.length);
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(start, end),
      );
    } catch {
      return { error: "not UTF-8 text" };
    }
    return { content, next_offset: offset + end, eof: bytes.length <= end };
  }

  /** Exposes a port and returns its preview URL once it is routable. */
  async exposePort(args: ExposePortToolArgs): Promise<ExposePortToolResult | ToolErrorResult> {
    if (!this.allowPreview) return disabled("expose_port");
    return recover("expose_port", async () => {
      // asRecord has checked that the required port is an integer.
      const port = toNumber(asRecord("expose_port", args).port) as number;
      return { preview_url: await this.sandbox.getUrl({ port }) };
    });
  }

  /** Snapshots the sandbox and waits up to 300 s until the snapshot can be rolled back to. */
  async checkpoint(args: CheckpointToolArgs = {}): Promise<CheckpointToolResult | ToolErrorResult> {
    if (!this.allowRollback) return disabled("checkpoint");
    return recover("checkpoint", async () => {
      const label = optionalString(asRecord("checkpoint", args), "label");
      try {
        const snap = await this.sandbox.snapshot({
          ...(label ? { name: label } : {}),
          waitUntilReady: true,
          timeoutMs: CHECKPOINT_TIMEOUT_S * 1000,
        });
        return { checkpoint_id: snap.id };
      } catch (err) {
        const result = checkpointError(err);
        if (result) return result;
        throw err;
      }
    });
  }

  /** Rolls the sandbox back in place to a checkpoint. */
  async rollback(args: RollbackToolArgs): Promise<RollbackToolResult | ToolErrorResult> {
    if (!this.allowRollback) return disabled("rollback");
    return recover("rollback", async () => {
      await this.sandbox.rollback(requireString(asRecord("rollback", args), "checkpoint_id"));
      return { ok: true as const };
    });
  }

  /** Starts a command with sh -lc in the background and returns its process id. */
  async startProcess(
    args: StartProcessToolArgs,
  ): Promise<StartProcessToolResult | ToolErrorResult> {
    if (!this.allowProcesses) return disabled("start_process");
    return recover("start_process", async () => {
      const a = asRecord("start_process", args);
      const command = requireString(a, "command");
      const cwd = optionalString(a, "cwd");
      try {
        const proc = await this.sandbox.processes.start("sh", { args: ["-lc", command], cwd });
        return { process_id: proc.id };
      } catch (err) {
        // sandboxd answers resource_exhausted at its concurrent process cap and its
        // in-flight request cap; a retry or stopping a process fixes either, so
        // the model sees it. Other 429s throw.
        if (err instanceof RateLimitError && err.code === "resource_exhausted") {
          return { error: shortError(errorText(err)) };
        }
        throw err;
      }
    });
  }

  /**
   * Returns a process's output since cursor, split by stream, and its exit code
   * once exited. wait_s (clamped to 0–60, default 0) first waits up to that long
   * for a running process to exit, so following a long command takes fewer turns.
   */
  async readProcessOutput(
    args: ReadProcessOutputToolArgs,
  ): Promise<ReadProcessOutputToolResult | ToolErrorResult> {
    if (!this.allowProcesses) return disabled("read_process_output");
    return recover("read_process_output", async () => {
      const a = asRecord("read_process_output", args);
      const processId = requireString(a, "process_id");
      const cursor = toNumber(a.cursor);
      const wait = clamp(a.wait_s, 0, 0, MAX_WAIT_S);
      let exitCode: number | null | undefined;
      if (wait > 0) exitCode = await this.waitForExit(processId, wait);
      const page = await this.sandbox.processes.logs(processId, { cursor });
      const join = (stream: "stdout" | "stderr") =>
        page.entries
          .filter((e) => e.stream === stream)
          .map((e) => e.data)
          .join("");
      const result: ReadProcessOutputToolResult = {
        stdout: truncate(join("stdout")),
        stderr: truncate(join("stderr")),
        cursor: page.cursor,
        state: page.state,
        dropped: page.dropped,
      };
      if (page.state !== "exited") return result;
      // The logs page carries no exit code; an exited page already holds all output.
      if (exitCode === undefined) {
        try {
          exitCode = (await this.sandbox.processes.get(processId)).exitCode;
        } catch (err) {
          // The status expired (about 10 minutes after exit) between the two
          // reads; the page is still worth returning without the exit code.
          if (err instanceof NotFoundError) return result;
          throw err;
        }
      }
      result.exit_code = exitCode;
      return result;
    });
  }

  /** Sends SIGTERM to a process; ok is false when it had already exited. */
  async stopProcess(args: StopProcessToolArgs): Promise<StopProcessToolResult | ToolErrorResult> {
    if (!this.allowProcesses) return disabled("stop_process");
    return recover("stop_process", async () => ({
      ok: await this.sandbox.processes.kill(
        requireString(asRecord("stop_process", args), "process_id"),
      ),
    }));
  }

  /** Reports whether a path exists and, when it does, its type, size and modification time. */
  async statPath(args: StatPathToolArgs): Promise<StatPathToolResult | ToolErrorResult> {
    return recover("stat_path", async () => {
      const path = requireString(asRecord("stat_path", args), "path");
      try {
        const entry = await this.sandbox.files.stat(path);
        return {
          exists: true as const,
          type: entry.type,
          size: entry.size,
          modified_time: entry.modifiedTime,
        };
      } catch (err) {
        // Only the sandbox's own not_found means a missing path; any other 404 is an error.
        if (err instanceof NotFoundError && apiErrorReasonCode(err) === "not_found") {
          return { exists: false as const };
        }
        throw err;
      }
    });
  }

  /** Moves or renames a file or directory. */
  async movePath(args: MovePathToolArgs): Promise<MovePathToolResult | ToolErrorResult> {
    return recover("move_path", async () => {
      const a = asRecord("move_path", args);
      await this.sandbox.files.move(requireString(a, "source"), requireString(a, "destination"));
      return { ok: true as const };
    });
  }

  /** Deletes a file or directory; a non-empty directory needs recursive: true. */
  async deletePath(args: DeletePathToolArgs): Promise<DeletePathToolResult | ToolErrorResult> {
    return recover("delete_path", async () => {
      const a = asRecord("delete_path", args);
      // call() has rejected a non-boolean; on a direct call it takes the default.
      const recursive = typeof a.recursive === "boolean" ? a.recursive : undefined;
      await this.sandbox.files.remove(requireString(a, "path"), { recursive });
      return { ok: true as const };
    });
  }

  /** Lists the sandbox's background processes, with each command as start_process was given it. */
  async listProcesses(
    args: ListProcessesToolArgs = {},
  ): Promise<ListProcessesToolResult | ToolErrorResult> {
    if (!this.allowProcesses) return disabled("list_processes");
    return recover("list_processes", async () => {
      asRecord("list_processes", args);
      const processes = (await this.sandbox.processes.list()).map((p) => {
        // start_process runs sh -lc <command>; show the model the command it passed.
        const argv = p.name === "sh" && p.args[0] === "-lc" ? p.args.slice(1) : [p.name, ...p.args];
        const listed: ListedProcess = {
          process_id: p.processId,
          command: argv.join(" "),
          state: p.state,
        };
        if (p.state === "exited") listed.exit_code = p.exitCode;
        return listed;
      });
      return { processes };
    });
  }

  // Blocks up to waitS seconds for a process to exit and returns its exit code,
  // or undefined if it is still running when the wait ends. sandboxd's own wait
  // ceiling is longer than MAX_WAIT_S, so the abort signal is what bounds it.
  private async waitForExit(processId: string, waitS: number): Promise<number | null | undefined> {
    const signal = AbortSignal.timeout(toMs(waitS));
    try {
      const status = await this.sandbox.processes.get(processId, { wait: true, signal });
      return status.state === "exited" ? status.exitCode : undefined;
    } catch (err) {
      if (err instanceof APIConnectionError && signal.aborted) return undefined;
      throw err;
    }
  }
}
