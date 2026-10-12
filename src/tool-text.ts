// Model-facing error text shared by the agent tools and their tests. Not part
// of the public API; the Python SDK words the same errors identically.

import { APIError, apiErrorBodyMessage } from "./errors.js";

// Error results keep only their first line, cut to this many characters, so an
// HTML error page from a proxy cannot flood the model's context.
const MAX_ERROR_CHARS = 500;

// Returns the text of an error for the model: an API error is built from its
// fields, so no URL, method or request id reaches the model.
export function errorText(err: Error): string {
  if (!(err instanceof APIError)) return err.message;
  const message = apiErrorBodyMessage(err);
  return `HTTP ${err.status}${err.code ? ` ${err.code}` : ""}${message ? `: ${message}` : ""}`;
}

// Returns the first line of text, cut to MAX_ERROR_CHARS code points with a trailing marker.
export function shortError(text: string): string {
  const line = Array.from(text.split("\n", 1)[0] ?? "");
  return line.length <= MAX_ERROR_CHARS
    ? line.join("")
    : `${line.slice(0, MAX_ERROR_CHARS).join("")}…`;
}
