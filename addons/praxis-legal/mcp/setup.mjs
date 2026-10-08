import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const origin = process.env.PRAXIS_BASE_URL;
const tokenRef = process.env.PRAXIS_MOSAIC_TOKEN_REF;
if (!origin || !tokenRef?.startsWith("op://")) {
  throw new Error("Set PRAXIS_BASE_URL and PRAXIS_MOSAIC_TOKEN_REF (op://...) before setup.");
}
const parsed = new URL(origin);
if ((parsed.protocol !== "https:" && !(["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.protocol === "http:")) || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
  throw new Error("Use an HTTPS Praxis origin or loopback HTTP for local tests.");
}
const base = platform() === "darwin"
  ? join(homedir(), "Library", "Application Support")
  : platform() === "win32"
    ? (process.env.APPDATA || join(homedir(), "AppData", "Roaming"))
    : (process.env.XDG_CONFIG_HOME || join(homedir(), ".config"));
const configPath = join(base, "mosaic-companion", "mcp-plugins.json");
const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));
mkdirSync(dirname(configPath), { recursive: true });
const servers = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : [];
if (!Array.isArray(servers)) throw new Error("Mosaic MCP configuration is not an array.");
const entry = {
  id: servers.find((server) => server.name === "praxis-legal")?.id || randomUUID(),
  name: "praxis-legal",
  description: "Praxis legal research orchestrator",
  transport: "stdio",
  command: process.execPath,
  args: [serverPath],
  env: { PRAXIS_BASE_URL: parsed.origin, PRAXIS_MOSAIC_TOKEN_REF: tokenRef },
  autoConnect: true,
};
const next = servers.filter((server) => server.name !== entry.name);
next.push(entry);
writeFileSync(configPath, JSON.stringify(next, null, 2), { mode: 0o600 });
console.log("Praxis Legal MCP server registered. Refresh MCP Servers in Mosaic.");
