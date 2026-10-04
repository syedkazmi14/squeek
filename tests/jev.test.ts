import assert from "node:assert/strict";
import { test } from "node:test";
import { createJevProvider } from "../packages/providers/src/jev.ts";
test("pins model and validates choice with fake transport only", async () => {
  let body = "";
  const provider = createJevProvider("test", {
    fetch: async (_url, init) => {
      body = String(init?.body);
      return Response.json({
        model: "jev-1.13.0",
        answers: { scam_category: { type: "choice", choice: "benign" } },
        usage: { input_tokens: 2 },
      });
    },
  });
  assert.deepEqual(await provider.classify("technical fixture"), {
    category: "benign",
    inputTokens: 2,
  });
  assert.equal(JSON.parse(body).model, "jev-1.13.0");
  const criteria = JSON.parse(body).questions.scam_category.criteria as Record<
    string,
    unknown
  >;
  assert.ok(
    Object.values(criteria).every(
      (value) => typeof value === "string" && value.length > 0,
    ),
  );
  assert.match(String(criteria.benign), /warnings/);
  assert.match(String(criteria.credential_request), /excluded/);
});
test("rejects authentication, malformed choices, and cancellation", async () => {
  for (const response of [
    new Response("", { status: 401 }),
    Response.json({
      answers: { scam_category: { type: "choice", choice: "execute" } },
      usage: { input_tokens: 1 },
    }),
  ])
    await assert.rejects(
      createJevProvider("test", { fetch: async () => response }).classify("x"),
    );
  const signal = AbortSignal.abort();
  await assert.rejects(
    createJevProvider("test", {
      fetch: async () => {
        throw Error("should not fetch");
      },
    }).classify("x", signal),
  );
});
test("bounds transient retries and timeout without live requests", async () => {
  let attempts = 0;
  await assert.rejects(
    createJevProvider("test", {
      fetch: async () => {
        attempts++;
        return new Response("", { status: 429 });
      },
    }).classify("fixture"),
  );
  assert.equal(attempts, 3);
  await assert.rejects(
    createJevProvider("test", {
      timeoutMs: 5,
      fetch: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(Error("deadline")),
            { once: true },
          );
        }),
    }).classify("fixture"),
  );
});

test("HTTP transport budget includes retries and survives repeated classifications", async () => {
  let attempts = 0;
  const provider = createJevProvider("test", {
    maxRequests: 1,
    fetch: async () => {
      attempts++;
      return new Response("", { status: 429 });
    },
  });
  await assert.rejects(provider.classify("fixture"), /budget/i);
  await assert.rejects(provider.classify("fixture"), /budget/i);
  assert.equal(attempts, 1);
});
