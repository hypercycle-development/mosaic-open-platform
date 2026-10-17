import assert from "node:assert/strict";
import test from "node:test";
import { askPraxis, extractAnswer } from "../mcp/orchestrator.mjs";

test("returns the user-bound Praxis agent answer", () => {
  assert.equal(extractAnswer({ choices: [{ message: { content: "Praxis answer" } }] }), "Praxis answer");
});

test("posts a scoped question to the orchestrator", async () => {
  let captured;
  const answer = await askPraxis("What is the rule?", {
    origin: "http://127.0.0.1:8100",
    token: "test-only",
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return { ok: true, json: async () => ({ choices: [{ message: { content: "The rule." } }] }) };
    },
  });
  assert.equal(answer, "The rule.");
  assert.equal(captured.url, "http://127.0.0.1:8100/v1/chat/completions");
  assert.deepEqual(JSON.parse(captured.options.body), { model: "praxis-legal", stream: false, messages: [{ role: "user", content: "What is the rule?" }] });
});

test("fails closed on missing response and insecure remote origin", async () => {
  assert.throws(() => extractAnswer({ choices: [] }), /no research answer/);
  await assert.rejects(askPraxis("Question", { origin: "http://praxis.example", token: "test-only" }), /HTTPS Praxis origin/);
});
