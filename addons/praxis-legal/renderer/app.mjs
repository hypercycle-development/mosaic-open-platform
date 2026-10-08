const status = document.querySelector("#status");
const checkConnection = document.querySelector("#check-connection");

function showStatus(message, error = false) {
  status.textContent = message;
  status.dataset.state = error ? "error" : "ready";
}

async function refreshConnection() {
  try {
    const servers = await window.addonAPI.mcp.listServers();
    const praxis = servers.find(server => server.name === "praxis-legal" && server.connected);
    if (!praxis) {
      showStatus("Add and connect praxis-legal in MCP Servers, then check again.", true);
      return;
    }
    const tools = await window.addonAPI.mcp.listTools("praxis-legal");
    const available = tools.some(tool => tool.name === "ask_praxis");
    showStatus(available
      ? "Connected: ask_praxis is available. Open AI Chat and ask your agent to use ask_praxis."
      : "Praxis is connected but ask_praxis is missing. Check the MCP server setup.", !available);
  } catch {
    showStatus("Could not check the Praxis MCP connection. Check MCP Servers and try again.", true);
  }
}

try {
  await window.addonAPI.init();
  await refreshConnection();
} catch {
  showStatus("Could not initialize the connection check.", true);
}
checkConnection.addEventListener("click", refreshConnection);
