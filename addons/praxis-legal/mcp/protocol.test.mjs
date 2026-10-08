import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Mosaic-compatible MCP handshake exposes ask_praxis", async () => {
  const client = new Client({ name: "praxis-protocol-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./server.mjs", import.meta.url))],
    env: { ...process.env, PRAXIS_MOSAIC_TOKEN_REF: "" },
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === "ask_praxis"));
    const result = await client.callTool({ name: "ask_praxis", arguments: { question: "Test question" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /1Password Mosaic access key reference/);
  } finally {
    await client.close();
  }
});

test("MCP call returns the orchestrator answer through the user-bound API", async () => {
  const bin = mkdtempSync(join(tmpdir(), "praxis-mcp-test-"));
  const opPath = join(bin, "op");
  writeFileSync(opPath, "#!/bin/sh\nprintf test-token\n");
  chmodSync(opPath, 0o700);
  let request;
  const praxis = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    request = { path: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: "Praxis orchestrator result" } }] }));
  });
  await new Promise((resolve) => praxis.listen(0, "127.0.0.1", resolve));
  const client = new Client({ name: "praxis-protocol-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./server.mjs", import.meta.url))],
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PRAXIS_BASE_URL: `http://127.0.0.1:${praxis.address().port}`,
      PRAXIS_MOSAIC_TOKEN_REF: "op://test/item/token",
    },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "ask_praxis", arguments: { question: "What is the rule?" } });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, "Praxis orchestrator result");
    assert.equal(request.path, "/v1/chat/completions");
    assert.equal(request.auth, "Bearer test-token");
    assert.equal(request.body.model, "praxis-legal");
    assert.equal(request.body.messages[0].content, "What is the rule?");
  } finally {
    await client.close();
    await new Promise((resolve) => praxis.close(resolve));
    rmSync(bin, { recursive: true });
  }
});
