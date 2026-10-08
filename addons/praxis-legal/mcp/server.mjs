import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askPraxis } from "./orchestrator.mjs";

const server = new McpServer({ name: "praxis-legal", version: "0.1.0" });
server.tool("ask_praxis", "Ask the user-bound Praxis legal research orchestrator. Returns its answer to the Mosaic agent.", {
  question: z.string().min(1).max(4_000).describe("The legal research question for Praxis."),
}, async ({ question }) => {
  try {
    return { content: [{ type: "text", text: await askPraxis(question) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
});
await server.connect(new StdioServerTransport());
