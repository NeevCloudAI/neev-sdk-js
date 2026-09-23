import { describe, expect, it } from "vitest";
import { type FetchLike, RawClient, createDispatch } from "../src/http.js";
import {
  APIConnectionError,
  APITimeoutError,
  BadRequestError,
  type NeevError,
  NotFoundError,
  RateLimitError,
} from "../src/index.js";
import { json, mockFetch } from "./helpers.js";

// A GET Request used to exercise the dispatch layer directly.
function req(): Request {
  return new Request("http://localhost:7010/x", { method: "GET" });
}

describe("createDispatch", () => {
  it("returns a successful response unchanged", async () => {
    const dispatch = createDispatch({
      fetch: async () => json(200, { ok: true }),
      timeoutMs: 50,
      maxRetries: 2,
    });
    const res = await dispatch(req());
    expect(res.status).toBe(200);
  });

  it("retries a 429 and then succeeds", async () => {
    let attempts = 0;
    const dispatch = createDispatch({
      fetch: async () => {
        attempts++;
        return attempts === 1 ? json(429, { error: "slow_down" }) : json(200, { ok: true });
      },
      timeoutMs: 50,
      maxRetries: 2,
    });
    const res = await dispatch(req());
    expect(res.status).toBe(200);
    expect(attempts).toBe(2);
  });

  it("returns the last response after exhausting retries", async () => {
    let attempts = 0;
    const dispatch = createDispatch({
      fetch: async () => {
        attempts++;
        return json(503, { error: "unavailable" });
      },
      timeoutMs: 50,
      maxRetries: 1,
    });
    const res = await dispatch(req());
    expect(res.status).toBe(503);
    expect(attempts).toBe(2);
  });

  it("raises APITimeoutError when the request exceeds the timeout", async () => {
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const dispatch = createDispatch({ fetch: hanging, timeoutMs: 10, maxRetries: 0 });
    await expect(dispatch(req())).rejects.toBeInstanceOf(APITimeoutError);
  });

  it("rejects with a caller-abort APIConnectionError, not a timeout", async () => {
    const controller = new AbortController();
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const dispatch = createDispatch({ fetch: hanging, timeoutMs: 1000, maxRetries: 2 });
    const request = new Request("http://localhost:7010/x", { signal: controller.signal });
    const promise = dispatch(request);
    controller.abort();
    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err).not.toBeInstanceOf(APITimeoutError);
    expect(String(err.message)).toContain("aborted by caller");
  });

  it("honors a numeric Retry-After header", async () => {
    let attempts = 0;
    const dispatch = createDispatch({
      fetch: async () => {
        attempts++;
        return attempts === 1
          ? json(429, { error: "slow_down" }, { "retry-after": "0" })
          : json(200, { ok: true });
      },
      timeoutMs: 50,
      maxRetries: 1,
    });
    const res = await dispatch(req());
    expect(res.status).toBe(200);
    expect(attempts).toBe(2);
  });

  it("raises APIConnectionError on a network failure", async () => {
    const dispatch = createDispatch({
      fetch: async () => {
        throw new TypeError("network down");
      },
      timeoutMs: 50,
      maxRetries: 0,
    });
    await expect(dispatch(req())).rejects.toBeInstanceOf(APIConnectionError);
  });
});

describe("RawClient (spec-less escape hatch)", () => {
  // Builds a RawClient over a queued base fetch.
  function rawClient(queue: Array<Response | Error>) {
    const mock = mockFetch(queue);
    const dispatch = createDispatch({ fetch: mock.fetch, timeoutMs: 1000, maxRetries: 0 });
    return {
      raw: new RawClient({ baseUrl: "http://localhost:7010", apiKey: "k", dispatch }),
      calls: mock.calls,
    };
  }

  it("sends an authenticated request and parses the JSON body", async () => {
    const { raw, calls } = rawClient([json(200, { value: 42 })]);
    const out = await raw.request<{ value: number }>({ method: "GET", path: "/v1/widgets" });
    expect(out.value).toBe(42);
    expect(calls[0]?.url).toBe("http://localhost:7010/v1/widgets");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer k");
  });

  it("returns undefined for an empty 204 body", async () => {
    const { raw } = rawClient([new Response(null, { status: 204 })]);
    const out = await raw.request<void>({ method: "DELETE", path: "/v1/widgets/1" });
    expect(out).toBeUndefined();
  });

  it("maps a 404 to NotFoundError with code, details, and request id", async () => {
    const { raw } = rawClient([
      json(404, { error: "not_found", details: "no widget" }, { "x-request-id": "req-9" }),
    ]);
    const err = (await raw
      .request({ method: "GET", path: "/v1/widgets/1" })
      .catch((e) => e)) as NeevError;
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).status).toBe(404);
    expect((err as NotFoundError).code).toBe("not_found");
    expect((err as NotFoundError).details).toBe("no widget");
    expect((err as NotFoundError).requestId).toBe("req-9");
  });

  it("maps status codes to the matching error subclass", async () => {
    const { raw } = rawClient([json(400, { error: "bad" })]);
    await expect(raw.request({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("maps a 429 to RateLimitError", async () => {
    const { raw } = rawClient([json(429, { error: "slow_down" })]);
    await expect(raw.request({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("omits null/undefined query parameters", async () => {
    const { raw, calls } = rawClient([json(200, {})]);
    await raw.request({
      method: "GET",
      path: "/x",
      query: { page: 2, limit: undefined, cursor: null },
    });
    expect(calls[0]?.url).toContain("page=2");
    expect(calls[0]?.url).not.toContain("limit");
    expect(calls[0]?.url).not.toContain("cursor");
  });
});
