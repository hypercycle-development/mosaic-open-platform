import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

async function loadApp(connected, tools = [{ name: "ask_praxis" }], fails = false) {
  const elements = new Map(["#status", "#check-connection"].map(id => [id, {
    textContent: "", dataset: {}, addEventListener(event, fn) { this.handler = fn; },
  }]));
  globalThis.document = { querySelector: selector => elements.get(selector) };
  globalThis.window = { addonAPI: {
    init: async () => ({}),
    mcp: {
      listServers: async () => { if (fails) throw new Error("offline"); return [{ name: "praxis-legal", connected }]; },
      listTools: async () => tools,
    },
  } };
  await import(`../renderer/app.mjs?case=${Math.random()}`);
  return elements;
}

test("MCP-only catalog has no chat form or agent permissions", () => {
  const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));
  assert.doesNotMatch(html, /textarea|prepare-chat|ask-praxis/);
  assert.deepEqual(manifest.permissions, ["mcp:read"]);
});
test("connected server with ask_praxis points users to Mosaic chat", async () => {
  const elements = await loadApp(true);
  assert.match(elements.get("#status").textContent, /ask_praxis.*AI Chat/);
  await elements.get("#check-connection").handler();
  assert.equal(elements.get("#status").dataset.state, "ready");
});
test("disconnected MCP requires setup", async () => {
  const elements = await loadApp(false);
  assert.match(elements.get("#status").textContent, /MCP Servers/);
  assert.equal(elements.get("#status").dataset.state, "error");
});
test("server without ask_praxis is not reported ready", async () => {
  const elements = await loadApp(true, []);
  assert.equal(elements.get("#status").dataset.state, "error");
});
test("connection error is visible", async () => {
  const elements = await loadApp(false, [], true);
  assert.equal(elements.get("#status").dataset.state, "error");
});
