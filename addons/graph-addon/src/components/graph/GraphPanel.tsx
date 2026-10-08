// =============================================================================
// GRAPH ADDON — Complete standalone knowledge constellation
// Extracted from StargateGraphPanel.tsx core (~2,500 LOC)
// Simplified for standalone addon while preserving all key features.
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Search, ZoomIn, ZoomOut, Send, X, Bot, Loader, Zap, Wallet, Shield,
  Box, Server, Wrench, GitBranch, ChevronDown, ChevronUp, Play, AlertTriangle,
  Network, Factory
} from 'lucide-react';
import { ParallelGraphExecutor } from '../../services/ParallelGraphExecutor';
import { HarnessLayer, HarnessConfig } from '../../services/HarnessLayer';
import FactoryHierarchyTree from './FactoryHierarchyTree';

// ── Addon API Types ──────────────────────────────────────────────────────────

interface AddonAPI {
  // Real Mosaic addonAPI surface: system, settings, files, events, ui, wallet, agents, mcp, nodes
  // vault is NOT exposed — removed per Dr. Robert review
  // API names per harness electron/addons/api/: agents.list/get/add/update; mcp.listServers/listTools/callTool
  // There is NO skills namespace and NO getAll/getServers methods.
  mcp?: { listServers: () => Promise<any[]>; listTools: (name?: string) => Promise<any[]> };
  agents?: { list: () => Promise<any[]>; get: (id: string | number) => Promise<any> };
  wallet?: { getAddress: () => Promise<any> };
  nodes?: { getNodes: () => Promise<any[]> };
}

// ── Types ──────────────────────────────────────────────────────────────────

interface NodeData {
  id: string;
  label: string;
  angle: number;
  ring: number;
  radius: number;
  color: string;
  type: string;
  size: number;
  importance: number;
  date?: Date;
  meta?: Record<string, any>;
}

interface EdgeData {
  from: string;
  to: string;
  strength: number;
  color: string;
}

// ── Demo Data ──────────────────────────────────────────────────────────────

const DEMO_NODES: NodeData[] = [
  // Ring 0: Center (Stargate)
  { id: 'center', label: 'Stargate', angle: 0, ring: 0, radius: 0, color: '#06b6d4', type: 'portal', size: 28, importance: 1 },

  // Ring 1: Vault Boxes (oldest)
  { id: 'box-1', label: 'Invoice OCR', angle: 0, ring: 1, radius: 120, color: '#06b6d4', type: 'vault', size: 10, importance: 0.8, date: new Date('2026-08-16'), meta: { entryCount: 12 } },
  { id: 'box-2', label: 'Midnight Config', angle: Math.PI * 0.33, ring: 1, radius: 120, color: '#06b6d4', type: 'vault', size: 8, importance: 0.6, date: new Date('2026-08-17'), meta: { entryCount: 5 } },
  { id: 'box-3', label: 'MCP Registry', angle: Math.PI * 0.66, ring: 1, radius: 120, color: '#06b6d4', type: 'vault', size: 9, importance: 0.7, date: new Date('2026-08-18'), meta: { entryCount: 8 } },
  { id: 'box-4', label: 'Agent Skills', angle: Math.PI, ring: 1, radius: 120, color: '#06b6d4', type: 'vault', size: 12, importance: 0.9, date: new Date('2026-08-19'), meta: { entryCount: 15 } },
  { id: 'box-5', label: 'Loop Designs', angle: Math.PI * 1.33, ring: 1, radius: 120, color: '#06b6d4', type: 'vault', size: 7, importance: 0.5, date: new Date('2026-08-20'), meta: { entryCount: 3 } },
  { id: 'box-6', label: 'Trading Rules', angle: Math.PI * 1.66, ring: 1, radius: 120, color: '#06b6d4', type: 'vault', size: 8, importance: 0.6, date: new Date('2026-08-21'), meta: { entryCount: 7 } },

  // Ring 2: MCPs
  { id: 'mcp-fs', label: 'filesystem', angle: Math.PI * 0.2, ring: 2, radius: 200, color: '#10b981', type: 'mcp', size: 11, importance: 0.85, meta: { toolCount: 8, initialized: true } },
  { id: 'mcp-gh', label: 'github', angle: Math.PI * 0.6, ring: 2, radius: 200, color: '#10b981', type: 'mcp', size: 14, importance: 1.0, meta: { toolCount: 12, initialized: true } },
  { id: 'mcp-ws', label: 'web-search', angle: Math.PI * 1.0, ring: 2, radius: 200, color: '#10b981', type: 'mcp', size: 9, importance: 0.7, meta: { toolCount: 3, initialized: true } },
  { id: 'mcp-db', label: 'sqlite', angle: Math.PI * 1.4, ring: 2, radius: 200, color: '#10b981', type: 'mcp', size: 10, importance: 0.75, meta: { toolCount: 6, initialized: true } },

  // Ring 3: Agents
  { id: 'agent-byron', label: 'Byron', angle: Math.PI * 0.25, ring: 3, radius: 280, color: '#8b5cf6', type: 'agent', size: 13, importance: 0.9, meta: { model: 'kimi-k2.6', provider: 'ollama-cloud', skills: ['midnight-city-stargate-integration','midnight-contract-authoring','midnight-wallet-integration','stargate-pool-integration','electron-mcp-servers','subagent-driven-development','hermes-agent-skill-authoring'] } },
  { id: 'agent-miner', label: 'Midnight Miner', angle: Math.PI * 0.75, ring: 3, radius: 280, color: '#8b5cf6', type: 'agent', size: 11, importance: 0.8, meta: { model: 'gpt-4o', provider: 'openai' } },
  { id: 'agent-tiller', label: 'Hyperbox Tiller', angle: Math.PI * 1.25, ring: 3, radius: 280, color: '#8b5cf6', type: 'agent', size: 10, importance: 0.75, meta: { model: 'claude-sonnet', provider: 'anthropic' } },

  // Ring 4: ANFEs / Skills
  { id: 'anfe-1', label: 'Node #1', angle: Math.PI * 0.4, ring: 4, radius: 360, color: '#ec4899', type: 'anfe', size: 10, importance: 0.8, meta: { tokenId: '4649559796048334', source: 'node-manager' } },
  { id: 'anfe-2', label: 'Node #2', angle: Math.PI * 1.4, ring: 4, radius: 360, color: '#ec4899', type: 'anfe', size: 10, importance: 0.8, meta: { tokenId: '4649559796048335', source: 'node-manager' } },
  { id: 'skill-1', label: 'web3:balance', angle: Math.PI * 0.9, ring: 4, radius: 360, color: '#f59e0b', type: 'skill', size: 7, importance: 0.5, meta: { category: 'web3' } },
  { id: 'skill-2', label: 'vault:read', angle: Math.PI * 1.9, ring: 4, radius: 360, color: '#f59e0b', type: 'skill', size: 7, importance: 0.5, meta: { category: 'vault' } },
];

const DEMO_EDGES: EdgeData[] = [
  { from: 'box-1', to: 'mcp-fs', strength: 0.7, color: '#06b6d422' },
  { from: 'box-4', to: 'agent-byron', strength: 0.9, color: '#8b5cf622' },
  { from: 'mcp-gh', to: 'agent-byron', strength: 0.8, color: '#10b98122' },
  { from: 'agent-miner', to: 'anfe-1', strength: 0.6, color: '#ec489922' },
  { from: 'box-3', to: 'mcp-ws', strength: 0.5, color: '#06b6d422' },
  { from: 'skill-1', to: 'agent-byron', strength: 0.4, color: '#f59e0b22' },
];

const RING_COLORS = ['#1e293b', '#334155', '#475569', '#64748b'];
const RING_LABELS = ['Portal', 'Vault', 'MCPs', 'Agents', 'ANFEs'];

// ── Component ──────────────────────────────────────────────────────────────

const GraphPanel: React.FC = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [api, setApi] = useState<AddonAPI | null>(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [nodes, setNodes] = useState<NodeData[]>(DEMO_NODES);
  const [edges, setEdges] = useState<EdgeData[]>(DEMO_EDGES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showLabels, setShowLabels] = useState(true);
  const [viewMode, setViewMode] = useState<'constellation' | 'factories'>('constellation');
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // ── Execution + Harness State ──────────────────────────────────────────────
  const [isExecuting, setIsExecuting] = useState(false);
  const [execResults, setExecResults] = useState<any[] | null>(null);
  const [execSummary, setExecSummary] = useState<any | null>(null);
  const [harnessViolations, setHarnessViolations] = useState<string[]>([]);
  const [agentChats, setAgentChats] = useState<Record<string, { role: string; content: string }[]>>({});
  const [chatInput, setChatInput] = useState('');
  const harnessRef = useRef<HarnessLayer | null>(null);

  useEffect(() => {
    const config = HarnessLayer.defaultNodeFactoryHarness();
    harnessRef.current = new HarnessLayer(config);
  }, []);

  useEffect(() => {
    const addonAPI = (window as any).addonAPI as AddonAPI | undefined;
    if (!addonAPI) {
      // Per Dr. Robert: surface the missing bridge instead of silently falling back to demo data.
      setBridgeMissing(true);
      return;
    }
    // Real addonAPI methods: mcp.listServers, agents.list. getServers/getAll do NOT exist.
    if (addonAPI.mcp?.listServers) {
      setApi(addonAPI);
    }
  }, []);

  const handleChatSubmit = async () => {
    if (!selectedNode || !chatInput.trim()) return;
    const msg = chatInput.trim();
    setAgentChats(prev => ({
      ...prev,
      [selectedNode.id]: [...(prev[selectedNode.id] || []), { role: 'user', content: msg }]
    }));
    setChatInput('');

    // Try real agent dispatch via addonAPI
    if (api?.agents) {
      try {
        const agents = await api.agents.list();
        const targetAgent = agents.find((a: any) => a.name === selectedNode.label || a.id === selectedNode.id.replace('agent-', ''));
        if (targetAgent && (targetAgent as any).sendMessage) {
          const response = await targetAgent.sendMessage(msg);
          setAgentChats(prev => ({
            ...prev,
            [selectedNode.id]: [...(prev[selectedNode.id] || []), { role: 'agent', content: response }]
          }));
          return;
        }
      } catch (e) {
        // Fall through to simulated response
      }
    }

    // Simulated response for demo
    setTimeout(() => {
      setAgentChats(prev => ({
        ...prev,
        [selectedNode.id]: [...(prev[selectedNode.id] || []), {
          role: 'agent',
          content: `${selectedNode.label} is analyzing your request: "${msg}". Based on my connected skills (${(selectedNode.meta?.skills || []).length}), I can help build this workflow. Would you like me to create a loop with the MCPs I'm connected to?`
        }]
      }));
    }, 800);
  };

  // ── Graph Execution ────────────────────────────────────────────────────────
  const handleExecuteGraph = async () => {
    if (isExecuting || !harnessRef.current) return;
    setIsExecuting(true);
    setExecResults(null);
    setExecSummary(null);
    setHarnessViolations([]);

    try {
      // Step 1: Harness permission check
      const tasks = nodes.map(n => ({
        id: n.id,
        resource: n.type as any,
        action: 'execute' as const,
        path: n.meta?.sourceId || undefined,
      }));
      const conflicts = harnessRef.current.detectConflicts(tasks);
      if (conflicts.length > 0) {
        setHarnessViolations(conflicts);
        setIsExecuting(false);
        return;
      }

      // Step 2: Run executor
      const executor = new ParallelGraphExecutor({ batchSize: 20, timeoutMs: 30000 });
      const execNodes = nodes
        .filter(n => n.type !== 'portal')
        .map(n => ({
          id: n.id,
          task: `${n.type}:${n.label}`,
          inputs: n.meta || {},
          dependencies: edges.filter(e => e.to === n.id).map(e => e.from),
        }));
      const results = await executor.fanOut(execNodes);
      const summary = await executor.layeredFanIn(results);
      setExecResults(results);
      setExecSummary(summary);
    } catch (err: any) {
      setError(err?.message || 'Execution failed');
    } finally {
      setIsExecuting(false);
    }
  };

  // Detect embedded mode
  useEffect(() => {
    const addonAPI = (window as any).addonAPI as AddonAPI | undefined;
    if (!addonAPI) return; // bridgeMissing already surfaced by the first effect
    // Real addonAPI methods: mcp.listServers, agents.list. getServers/getAll do NOT exist.
    if (addonAPI.mcp?.listServers) {
      setApi(addonAPI);
    }
  }, []);

  // Fetch live data — every addonAPI call is optional-chained:
  // a synchronous throw inside a promise executor lands before any .catch() can attach.
  const refresh = async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [servers, agents] = await Promise.all([
        api.mcp?.listServers?.().catch(() => []) ?? Promise.resolve([]),
        api.agents?.list?.().catch(() => []) ?? Promise.resolve([]),
        // Note: there is NO skills namespace on addonAPI — dropped entirely.
      ]);
      const skills: any[] = [];

      // Build live nodes from real data
      const liveNodes: NodeData[] = [
        { id: 'center', label: 'Stargate', angle: 0, ring: 0, radius: 0, color: '#06b6d4', type: 'portal', size: 28, importance: 1 },
      ];

      // Vault ring — REMOVED per Dr. Robert: vault is not on addonAPI surface
      // Vault data unavailable; nodes remain as demo data from DEMO_NODES

      // MCP ring
      servers.forEach((s: any, i: number) => {
        const angle = (i / Math.max(servers.length, 1)) * Math.PI * 2 + 0.5;
        liveNodes.push({
          id: `mcp-${s.name}`,
          label: s.name,
          angle,
          ring: 2,
          radius: 200,
          color: '#10b981',
          type: 'mcp',
          size: 8 + (s.toolCount || 0) * 0.8,
          importance: 0.5 + Math.min((s.toolCount || 0) / 15, 0.5),
          meta: { toolCount: s.toolCount || 0, initialized: s.initialized },
        });
      });

      // Agent ring
      agents.forEach((a: any, i: number) => {
        const angle = (i / Math.max(agents.length, 1)) * Math.PI * 2 + 1.0;
        liveNodes.push({
          id: `agent-${a.id}`,
          label: a.name || a.id,
          angle,
          ring: 3,
          radius: 280,
          color: '#8b5cf6',
          type: 'agent',
          size: 12,
          importance: 0.8,
          meta: { model: a.model, provider: a.provider },
        });
      });

      if (liveNodes.length > 1) {
        setNodes(liveNodes);
        // Derive edges from agent skills → MCP relationships
        const liveEdges: EdgeData[] = [];
        agents.forEach((a: any) => {
          const agentNode = liveNodes.find(n => n.id === `agent-${a.id}`);
          if (!agentNode) return;
          (a.skills || []).forEach((skillName: string) => {
            // Find MCP that provides this skill
            const targetMcp = servers.find((s: any) =>
              (s.tools || []).some((t: any) => t.name?.includes(skillName) || t.description?.includes(skillName))
            );
            if (targetMcp) {
              liveEdges.push({
                from: `agent-${a.id}`,
                to: `mcp-${targetMcp.name}`,
                strength: 0.8,
                color: '#8b5cf622',
              });
            }
            // Vault box edges — REMOVED per Dr. Robert: vault not on addonAPI
          });
        });
        // Add skill-to-agent edges if skills exist
        (skills || []).forEach((skill: any, i: number) => {
          const agentNode = liveNodes.find(n => n.type === 'agent');
          if (agentNode) {
            liveEdges.push({
              from: `skill-${i}`,
              to: agentNode.id,
              strength: 0.4,
              color: '#f59e0b22',
            });
          }
        });
        setEdges(liveEdges);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch live data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (api) refresh();
  }, [api]);

  const isEmbedded = !!api;
  const centerX = 500;
  const centerY = 350;

  const filteredNodes = useMemo(() => {
    if (!searchQuery) return nodes;
    return nodes.filter(n => n.label.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [nodes, searchQuery]);

  // Pan / zoom handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.3, Math.min(3, z * delta)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const nodePos = (n: NodeData) => {
    const r = n.radius * zoom;
    return {
      x: centerX + Math.cos(n.angle) * r + pan.x,
      y: centerY + Math.sin(n.angle) * r + pan.y,
    };
  };

  // Counts
  const vaultCount = nodes.filter(n => n.type === 'vault').length;
  const mcpCount = nodes.filter(n => n.type === 'mcp').length;
  const agentCount = nodes.filter(n => n.type === 'agent').length;
  const anfeCount = nodes.filter(n => n.type === 'anfe').length;
  const totalTools = nodes.filter(n => n.type === 'mcp').reduce((sum, n) => sum + (n.meta?.toolCount || 0), 0);

  return (
    <div className="h-full w-full flex flex-col bg-[#0a0f1a] text-gray-200"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Toolbar */}
      <div className="h-11 border-b border-gray-800/50 flex items-center px-3 gap-2 bg-[#0f172a]/80 backdrop-blur">
        <Zap size={14} className="text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">Knowledge Constellation</span>
        <div className="w-px h-5 bg-gray-700 mx-1" />

        <button
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${viewMode === 'constellation' ? 'bg-cyan-900/40 text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`}
          onClick={() => setViewMode('constellation')}
        >
          <Network size={12} /> Constellation
        </button>
        <button
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${viewMode === 'factories' ? 'bg-green-900/40 text-green-300' : 'text-gray-500 hover:text-gray-300'}`}
          onClick={() => setViewMode('factories')}
        >
          <Factory size={12} /> Factories
        </button>
        <div className="w-px h-5 bg-gray-700 mx-1" />

        {/* View mode toggle */}
        <button
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${viewMode === 'constellation' ? 'bg-cyan-900/40 text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`}
          onClick={() => setViewMode('constellation')}
        >
          <Network size={12} /> Constellation
        </button>
        <button
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${viewMode === 'factories' ? 'bg-green-900/40 text-green-300' : 'text-gray-500 hover:text-gray-300'}`}
          onClick={() => setViewMode('factories')}
        >
          <Factory size={12} /> Factories
        </button>
        <div className="w-px h-5 bg-gray-700 mx-1" />

        <div className="flex items-center gap-1 bg-gray-800/50 rounded px-2 py-1">
          <Search size={12} className="text-gray-500" />
          <input
            className="bg-transparent text-xs text-gray-300 outline-none w-32 placeholder-gray-600"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && <X size={12} className="text-gray-500 cursor-pointer" onClick={() => setSearchQuery('')} />}
        </div>

        <div className="flex-1" />

        <button className="p-1.5 hover:bg-gray-800 rounded" onClick={() => setZoom(z => Math.min(3, z * 1.2))}>
          <ZoomIn size={14} className="text-gray-400" />
        </button>
        <span className="text-[10px] text-gray-500 w-8 text-center">{Math.round(zoom * 100)}%</span>
        <button className="p-1.5 hover:bg-gray-800 rounded" onClick={() => setZoom(z => Math.max(0.3, z * 0.8))}>
          <ZoomOut size={14} className="text-gray-400" />
        </button>

        <button className="p-1.5 hover:bg-gray-800 rounded" onClick={() => setShowLabels(!showLabels)}>
          {showLabels ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronUp size={14} className="text-gray-400" />}
        </button>

        {isEmbedded && (
          <button
            className="text-xs text-gray-500 hover:text-cyan-400 flex items-center gap-1 ml-2 disabled:opacity-50"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        )}

        <span className="text-[10px] text-gray-600 ml-2">
          {isEmbedded ? '🔌 Live' : '📦 Demo'}
        </span>
      </div>

      {/* Harness Violations Banner */}
      {harnessViolations.length > 0 && (
        <div className="px-3 py-2 bg-red-900/30 border-b border-red-700/40">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-red-400" />
            <span className="text-xs font-semibold text-red-300">Harness Violations Detected</span>
          </div>
          <div className="space-y-0.5">
            {harnessViolations.map((v, i) => (
              <p key={i} className="text-[10px] text-red-400 pl-5">• {v}</p>
            ))}
          </div>
        </div>
      )}

      {/* Execution Results Panel */}
      {execSummary && (
        <div className="px-3 py-2 bg-emerald-900/20 border-b border-emerald-700/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1">
              <Zap size={12} /> Execution Complete
            </span>
            <span className="text-[10px] text-emerald-500">{execSummary.success}/{execSummary.total} succeeded · {execSummary.avgDurationMs?.toFixed(0)}ms avg</span>
          </div>
          {execSummary.failure > 0 && (
            <p className="text-[10px] text-amber-400 mt-1">⚠️ {execSummary.failure} node(s) failed — check console</p>
          )}
        </div>
      )}

      {/* Missing-bridge banner — replace silent demo data fallback */}
      {bridgeMissing && (
        <div className="px-3 py-2 bg-amber-900/30 border-b border-amber-700/50 text-[10px] text-amber-300 flex items-center gap-2">
          <AlertTriangle size={12} />
          <span>No addon bridge detected — this addon is running outside Mosaic's addon runtime (no window.addonAPI). Showing demo data.</span>
        </div>
      )}

      {error && (
        <div className="px-3 py-1 bg-red-900/20 border-b border-red-800/40 text-[10px] text-red-400">
          ⚠️ {error}
        </div>
      )}

      {/* Canvas area */}
      {viewMode === 'factories' ? (
        <div className="flex-1 relative overflow-hidden">
          <FactoryHierarchyTree />
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden" onWheel={handleWheel}>
        <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing"
          viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            <linearGradient id="portalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3"/>
              <stop offset="100%" stopColor="#0891b2" stopOpacity="0.1"/>
            </linearGradient>
          </defs>

          {/* Background grid */}
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5"/>
          </pattern>
          <rect width="1000" height="700" fill="url(#grid)" />

          {/* Ring labels */}
          {[120, 200, 280, 360].map((r, i) => (
            <g key={`ring-${i}`}>
              <circle
                cx={centerX + pan.x}
                cy={centerY + pan.y}
                r={r * zoom}
                fill="none"
                stroke={RING_COLORS[i]}
                strokeWidth="0.5"
                strokeDasharray="4 4"
                opacity="0.3"
              />
              <text
                x={centerX + pan.x + r * zoom + 8}
                y={centerY + pan.y - 4}
                fill="#475569"
                fontSize="8"
                fontFamily="ui-monospace, monospace"
              >
                {RING_LABELS[i + 1]}
              </text>
            </g>
          ))}

          {/* Edges — curved bezier with selection glow */}
          {edges.map((edge, i) => {
            const fromNode = nodes.find(n => n.id === edge.from);
            const toNode = nodes.find(n => n.id === edge.to);
            if (!fromNode || !toNode) return null;
            const f = nodePos(fromNode);
            const t = nodePos(toNode);
            const isConnected = selectedNode && (edge.from === selectedNode.id || edge.to === selectedNode.id);
            const mx = (f.x + t.x) / 2;
            const my = (f.y + t.y) / 2;
            const dx = t.x - f.x;
            const dy = t.y - f.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const offset = dist * 0.15;
            const cx = mx - dy * (offset / dist);
            const cy = my + dx * (offset / dist);
            const path = `M ${f.x} ${f.y} Q ${cx} ${cy} ${t.x} ${t.y}`;

            return (
              <g key={`edge-${i}`}>
                <path
                  d={path}
                  fill="none"
                  stroke={isConnected ? fromNode.color : edge.color}
                  strokeWidth={isConnected ? edge.strength * 2.5 : edge.strength * 1.2}
                  opacity={selectedNode ? (isConnected ? 1 : 0.15) : 0.5}
                  strokeDasharray={isConnected ? "none" : "4 3"}
                  style={{
                    filter: isConnected ? 'drop-shadow(0 0 4px ' + fromNode.color + ')' : 'none',
                    transition: 'all 0.3s ease',
                  }}
                />
                {/* Arrowhead for direction */}
                {isConnected && (
                  <polygon
                    points={`0,-4 8,0 0,4`}
                    fill={fromNode.color}
                    transform={`translate(${t.x},${t.y}) rotate(${Math.atan2(t.y - cy, t.x - cx) * 180 / Math.PI})`}
                    opacity={0.8}
                  />
                )}
              </g>
            );
          })}

          {/* Nodes — with dimming when another is selected */}
          {filteredNodes.map(node => {
            const pos = nodePos(node);
            const isCenter = node.ring === 0;
            const isSelected = selectedNode?.id === node.id;
            const isDimmed = selectedNode && !isSelected && !getConnectedNodes(selectedNode.id, edges, nodes).some(n => n.id === node.id) && selectedNode.id !== node.id;

            return (
              <g
                key={node.id}
                onClick={() => setSelectedNode(isSelected ? null : node)}
                className="cursor-pointer"
              >
                {isCenter ? (
                  <>
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={node.size * zoom}
                      fill="url(#portalGrad)"
                      stroke={isSelected ? '#fff' : node.color}
                      strokeWidth={isSelected ? 3 : 2}
                      filter="url(#glow)"
                      opacity={isDimmed ? 0.15 : 1}
                      style={{ transition: 'opacity 0.3s ease' }}
                    />
                    <text
                      x={pos.x}
                      y={pos.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={node.color}
                      fontSize={10 * zoom}
                      fontWeight="bold"
                    >
                      ★
                    </text>
                  </>
                ) : (
                  <>
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={(node.size * zoom) / 2}
                      fill={`${node.color}18`}
                      stroke={isSelected ? '#fff' : node.color}
                      strokeWidth={isSelected ? 2 : 1}
                      opacity={isDimmed ? 0.15 : 0.9}
                      style={{ transition: 'opacity 0.3s ease' }}
                    />
                    {showLabels && zoom > 0.6 && (
                      <g>
                        <text
                          x={pos.x}
                          y={pos.y + (node.size * zoom) / 2 + 11}
                          textAnchor="middle"
                          fill="#94a3b8"
                          fontSize={Math.max(7, 8 * zoom)}
                          fontFamily="ui-sans-serif, system-ui"
                          className="pointer-events-none"
                        >
                          {node.label.length > 12 ? node.label.slice(0, 11) + '…' : node.label}
                        </text>
                      </g>
                    )}
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {viewMode === 'constellation' ? (
          <>
            {/* ── Floating Action Button: Execute Graph ── */}
            <button
              onClick={handleExecuteGraph}
              disabled={isExecuting}
              className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${
                isExecuting
                  ? 'bg-gray-700 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-500 hover:scale-110'
              }`}
              style={{
                boxShadow: isExecuting ? 'none' : '0 0 20px rgba(147, 51, 234, 0.5), 0 0 40px rgba(147, 51, 234, 0.3)',
                animation: isExecuting ? 'none' : 'pulse-glow 2s infinite',
              }}
            >
              {isExecuting ? (
                <Loader size={20} className="text-gray-400 animate-spin" />
              ) : (
                <Play size={22} className="text-white fill-white" />
              )}
            </button>

            {/* Tooltip on hover (hidden label replacement) */}
            <style>{`
              @keyframes pulse-glow {
                0%, 100% { box-shadow: 0 0 20px rgba(147, 51, 234, 0.5), 0 0 40px rgba(147, 51, 234, 0.3); }
                50% { box-shadow: 0 0 30px rgba(147, 51, 234, 0.7), 0 0 60px rgba(147, 51, 234, 0.5); }
              }
            `}</style>

            {/* Ring Color Legend (bottom-left) */}
            <div className="absolute bottom-3 left-3 bg-gray-900/80 border border-gray-700 rounded-lg p-2 backdrop-blur pointer-events-none">
              <div className="text-[9px] text-gray-400 font-medium mb-1">Rings</div>
              {[
                { label: 'Vault', color: '#06b6d4' },
                { label: 'MCPs', color: '#10b981' },
                { label: 'Agents', color: '#8b5cf6' },
                { label: 'ANFEs', color: '#ec4899' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-[9px] text-gray-500">{item.label}</span>
                </div>
              ))}
            </div>

            {/* Badge panel (top-right) */}
            <div className="absolute top-3 right-3 space-y-1.5 pointer-events-none">
              <Badge icon={<Box size={10}/>} label="Vault" value={vaultCount} color="cyan" />
              <Badge icon={<Server size={10}/>} label="MCPs" value={`${mcpCount} · ${totalTools}t`} color="emerald" />
              <Badge icon={<Bot size={10}/>} label="Agents" value={agentCount} color="purple" />
              <Badge icon={<Shield size={10}/>} label="ANFEs" value={anfeCount} color="pink" />
            </div>
          </>
        ) : null}

        {/* Selected node detail (bottom-left) */}
        {selectedNode && (
          <div className="absolute bottom-3 left-3 w-80 bg-gray-900/95 border border-gray-700 rounded-lg p-4 backdrop-blur shadow-2xl max-h-[50vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-gray-100">{selectedNode.label}</div>
                <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                  <span className={`px-1 py-0.5 rounded text-[9px] ${
                    selectedNode.type === 'vault' ? 'bg-cyan-900/40 text-cyan-400' :
                    selectedNode.type === 'mcp' ? 'bg-emerald-900/40 text-emerald-400' :
                    selectedNode.type === 'agent' ? 'bg-purple-900/40 text-purple-400' :
                    'bg-pink-900/40 text-pink-400'
                  }`}>{selectedNode.type}</span>
                  <span>· {selectedNode.importance.toFixed(2)} importance</span>
                </div>
              </div>
              <button onClick={() => setSelectedNode(null)}>
                <X size={14} className="text-gray-500 hover:text-gray-300" />
              </button>
            </div>

            {/* Provider & Model */}
            {selectedNode.meta?.provider && (
              <div className="mb-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Provider</div>
                <div className="text-xs text-gray-300">{selectedNode.meta.provider} · {selectedNode.meta.model || '—'}</div>
              </div>
            )}

            {/* Skills */}
            {selectedNode.meta?.skills && Array.isArray(selectedNode.meta.skills) && selectedNode.meta.skills.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Skills ({selectedNode.meta.skills.length})</div>
                <div className="flex flex-wrap gap-1">
                  {selectedNode.meta.skills.map((skill: string, i: number) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 text-[9px] border border-blue-800/30">{skill}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Connected Nodes */}
            {(() => {
              const connected = getConnectedNodes(selectedNode.id, edges, nodes);
              if (connected.length === 0) return null;
              return (
                <div className="mb-3">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Connected to ({connected.length})</div>
                  <div className="space-y-1">
                    {connected.map((n) => (
                      <div key={n.id} className="flex items-center gap-2 text-[10px] text-gray-400">
                        <span className={`w-2 h-2 rounded-full`} style={{ backgroundColor: n.color }} />
                        <span>{n.label}</span>
                        <span className="text-gray-600">({n.type})</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Chat with Agent */}
            {selectedNode.type === 'agent' && (
              <div className="mt-3 pt-3 border-t border-gray-800">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Chat with {selectedNode.label}</div>
                <div className="bg-gray-800/50 rounded p-2 min-h-[60px] max-h-[120px] overflow-y-auto mb-2 space-y-1">
                  {(agentChats[selectedNode.id] || []).map((msg, i) => (
                    <div key={i} className={`text-[10px] ${msg.role === 'user' ? 'text-cyan-300' : 'text-gray-300'}`}>
                      <span className="font-semibold">{msg.role === 'user' ? 'You' : selectedNode.label}: </span>{msg.content}
                    </div>
                  ))}
                  {(agentChats[selectedNode.id] || []).length === 0 && (
                    <div className="text-[10px] text-gray-600 italic">Ask {selectedNode.label} to create loops, run tasks, or explore connections...</div>
                  )}
                </div>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleChatSubmit(); }}
                    placeholder={`Ask ${selectedNode.label}...`}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-purple-500"
                  />
                  <button
                    onClick={handleChatSubmit}
                    className="px-2 py-1 bg-purple-900/40 text-purple-300 rounded hover:bg-purple-900/60 transition-colors"
                  >
                    <Send size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="mt-3 pt-3 border-t border-gray-800 space-y-1.5">
              {selectedNode.type === 'agent' && (
                <>
                  <button className="w-full flex items-center gap-2 px-3 py-1.5 rounded bg-purple-900/30 text-purple-300 text-[11px] hover:bg-purple-900/50 transition-colors border border-purple-800/30"
                    onClick={() => {
                      // Bridge to LoopBuilder with this agent pre-selected
                      window.parent.postMessage({
                        type: 'STARGATE_CREATE_LOOP',
                        agentId: selectedNode.id,
                        agentName: selectedNode.label,
                        skills: selectedNode.meta?.skills || [],
                      }, '*');
                    }}
                  >
                    <GitBranch size={12} /> Create Loop with {selectedNode.label}
                  </button>
                  <button className="w-full flex items-center gap-2 px-3 py-1.5 rounded bg-blue-900/30 text-blue-300 text-[11px] hover:bg-blue-900/50 transition-colors border border-blue-800/30"
                    onClick={() => {
                      // Dispatch task to agent
                      const msg = `Dispatch task to ${selectedNode.label}: analyze connected nodes and suggest a workflow.`;
                      setAgentChats(prev => ({
                        ...prev,
                        [selectedNode.id]: [...(prev[selectedNode.id] || []), { role: 'user', content: msg }]
                      }));
                    }}
                  >
                    <Zap size={12} /> Dispatch Task
                  </button>
                </>
              )}
              <button className="w-full flex items-center gap-2 px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-[11px] hover:bg-gray-700 transition-colors border border-gray-700/50"
                onClick={() => { setSelectedNode(null); refresh(); }}
              >
                <RefreshCw size={12} /> Refresh Nodes
              </button>
            </div>
          </div>
        )}
      </div>
    )}
    </div>
  );
};

// ── Connected Node Helper ────────────────────────────────────────────────────

function getConnectedNodes(nodeId: string, edges: EdgeData[], nodes: NodeData[]): NodeData[] {
  const connectedIds = edges
    .filter(e => e.from === nodeId || e.to === nodeId)
    .map(e => e.from === nodeId ? e.to : e.from);
  return nodes.filter(n => connectedIds.includes(n.id));
}

// ── Badge helper ─────────────────────────────────────────────────────────────

const Badge: React.FC<{ icon: React.ReactNode; label: string; value: string | number; color: string }> = ({ icon, label, value, color }) => {
  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    cyan: { bg: 'bg-cyan-900/30', text: 'text-cyan-400', border: 'border-cyan-700/40' },
    emerald: { bg: 'bg-emerald-900/30', text: 'text-emerald-400', border: 'border-emerald-700/40' },
    purple: { bg: 'bg-purple-900/30', text: 'text-purple-400', border: 'border-purple-700/40' },
    pink: { bg: 'bg-pink-900/30', text: 'text-pink-400', border: 'border-pink-700/40' },
  };
  const c = colorMap[color] || colorMap.cyan;
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${c.bg} ${c.border} backdrop-blur`}>
      <span className={c.text}>{icon}</span>
      <span className="text-[10px] text-gray-400">{label}</span>
      <span className={`text-[10px] font-medium ${c.text}`}>{value}</span>
    </div>
  );
};

export default GraphPanel;
