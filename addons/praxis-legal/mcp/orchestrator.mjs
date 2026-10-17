import { execFileSync } from "node:child_process";

export function readToken(ref = process.env.PRAXIS_MOSAIC_TOKEN_REF) {
  if (!ref?.startsWith("op://")) throw new Error("Configure a 1Password Mosaic access key reference.");
  return execFileSync("op", ["read", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function extractAnswer(payload) {
  const answer = payload?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("Praxis returned no research answer.");
  return answer;
}

export async function askPraxis(query, { origin = process.env.PRAXIS_BASE_URL, token = readToken(), fetchImpl = fetch } = {}) {
  if (typeof query !== "string" || !query.trim() || query.length > 4_000) throw new Error("Question must contain 1–4,000 characters.");
  const url = new URL(origin);
  const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use an HTTPS Praxis origin (or loopback HTTP for local tests).");
  }
  if (!token) throw new Error("Praxis Mosaic access key is unavailable.");
  const response = await fetchImpl(new URL("/v1/chat/completions", url), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: "praxis-legal", stream: false, messages: [{ role: "user", content: query.trim() }] }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Praxis request failed (HTTP ${response.status}).`);
  return extractAnswer(await response.json());
}
