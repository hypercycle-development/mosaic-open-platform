import { useEffect, useState } from "react";
import { Activity, RefreshCw, Server, ShieldCheck } from "lucide-react";

type MosaicNode = {
  id: string;
  name: string;
  apiHost: string;
  apiPort?: string;
  isActive: boolean;
  licenseKey?: string;
};

function App() {
  const [nodes, setNodes] = useState<MosaicNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNodes = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.addonAPI.nodes.list();
      setNodes(result);
    } catch (err) {
      const parsed = window.addonAPI.parseError(err);
      setError(parsed.message || "Não foi possível obter os nodes do Mosaic.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNodes();
  }, []);

  const activeNodes = nodes.filter((node) => node.isActive).length;

  return (
    <div className="app">
      <header className="header">
        <div>
          <div className="title-row">
            <Server size={22} />
            <h1>Fleet Manager</h1>
          </div>
          <p>Gestão e diagnóstico de nodes HyperCycle</p>
        </div>

        <button className="refresh" onClick={loadNodes} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          Atualizar
        </button>
      </header>

      <section className="status-card">
        <div className="status-icon">
          <ShieldCheck size={22} />
        </div>

        <div>
          <strong>Add-on conectado ao Mosaic</strong>
          <span>
            Os dados abaixo são obtidos através da API real de Add-ons do Mosaic.
          </span>
        </div>
      </section>

      <section className="metrics">
        <div className="metric">
          <span>Nodes</span>
          <strong>{loading ? "…" : nodes.length}</strong>
        </div>

        <div className="metric">
          <span>Ativos</span>
          <strong>{loading ? "…" : activeNodes}</strong>
        </div>

        <div className="metric">
          <span>API</span>
          <strong>{error ? "ERRO" : "READY"}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Nodes do Mosaic</h2>
            <p>Nodes efetivamente disponibilizados ao Add-on.</p>
          </div>

          <Activity size={20} />
        </div>

        {loading && (
          <div className="empty">
            A consultar os nodes do Mosaic…
          </div>
        )}

        {!loading && error && (
          <div className="error">
            <strong>Não foi possível carregar os nodes.</strong>
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && nodes.length === 0 && (
          <div className="empty">
            O Mosaic não disponibilizou nenhum node ao Add-on neste momento.
          </div>
        )}

        {!loading && !error && nodes.length > 0 && (
          <div className="node-list">
            {nodes.map((node) => (
              <div className="node-card" key={node.id}>
                <div className="node-main">
                  <div className={`node-dot ${node.isActive ? "active" : ""}`} />

                  <div>
                    <strong>{node.name || node.id}</strong>
                    <span>
                      {node.apiHost}
                      {node.apiPort ? `:${node.apiPort}` : ""}
                    </span>
                  </div>
                </div>

                <div className="node-status">
                  {node.isActive ? "ATIVO" : "INATIVO"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer>
        Fleet Manager Add-on · Mosaic Companion
      </footer>
    </div>
  );
}

export default App;
