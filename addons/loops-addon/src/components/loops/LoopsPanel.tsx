// =============================================================================
// LOOPS ADDON — Complete standalone loop designer
// Extracted from Stargate Command Center Loops tab (~600+ LOC)
// Full CRUD, topology cards, node/edge counts, import/export.
// =============================================================================

import React, { useState, useMemo, useEffect } from 'react';
import {
  GitBranch, Plus, Upload, Download, Trash2, Edit3, Play,
  X, ChevronRight, Clock, Layers, Zap, Bot, Server, Box,
  CheckCircle, AlertTriangle
} from 'lucide-react';
import LoopBuilderModal from './LoopBuilderModal';
import { StateManager } from '../../services/StateManager';

// ── Addon API Types ──────────────────────────────────────────────────────────

interface AddonAPI {
  // Real Mosaic addonAPI surface: system, settings, files, events, ui, wallet, agents, mcp, nodes
  // vault is NOT exposed — removed per Dr. Robert review
  agents?: { list: () => Promise<any[]>; };
  mcp?: { listServers: () => Promise<any[]>; };
}

// ── Types ──────────────────────────────────────────────────────────────────

interface LoopNode {
  id: string;
  type: 'vault-read' | 'vault-write' | 'agent-action' | 'mcp-call' | 'checkpointer' | 'verifier';
  label: string;
  sourceId?: string;
}

interface LoopEdge {
  from: string;
  to: string;
}

interface Loop {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'running' | 'paused' | 'error';
  tag: 'graph-created' | 'custom';
  nodes: LoopNode[];
  edges: LoopEdge[];
  createdAt: string;
}

// ── Demo Data (6 designs from screenshot) ────────────────────────────────────

const DEMO_LOOPS: Loop[] = [
  {
    id: 'loop-1',
    name: 'Deep Research',
    description: 'Karpathy-style deep research: search broadly, synthesize narrowly, verify completeness. Uses gbrain for knowledge graph + hermes for web search.',
    status: 'draft',
    tag: 'graph-created',
    nodes: [
      { id: 'n1', type: 'vault-read', label: 'Seed Query', sourceId: 'box-1' },
      { id: 'n2', type: 'mcp-call', label: 'Web Search', sourceId: 'web-search' },
      { id: 'n3', type: 'agent-action', label: 'Synthesize', sourceId: 'agent-1' },
      { id: 'n4', type: 'mcp-call', label: 'Knowledge Graph', sourceId: 'filesystem' },
      { id: 'n5', type: 'verifier', label: 'Verify Completeness' },
      { id: 'n6', type: 'vault-write', label: 'Save Results', sourceId: 'box-1' },
      { id: 'n7', type: 'checkpointer', label: 'Checkpoint' },
      { id: 'n8', type: 'mcp-call', label: 'Expand Search', sourceId: 'web-search' },
      { id: 'n9', type: 'agent-action', label: 'Final Review', sourceId: 'agent-1' },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4' },
      { from: 'n4', to: 'n5' },
      { from: 'n5', to: 'n6' },
      { from: 'n5', to: 'n7' },
      { from: 'n7', to: 'n8' },
      { from: 'n8', to: 'n9' },
    ],
    createdAt: '2026-08-20',
  },
  {
    id: 'loop-2',
    name: 'Code Review with Quality Gates',
    description: 'Karpathy-style code workflow: draft → test → fix → verify → save. Uses agent skill training pattern with verification checkpoints.',
    status: 'draft',
    tag: 'graph-created',
    nodes: [
      { id: 'n1', type: 'vault-read', label: 'Draft Code', sourceId: 'box-2' },
      { id: 'n2', type: 'mcp-call', label: 'Run Tests', sourceId: 'github' },
      { id: 'n3', type: 'agent-action', label: 'Fix Issues', sourceId: 'agent-1' },
      { id: 'n4', type: 'verifier', label: 'Quality Gate' },
      { id: 'n5', type: 'vault-write', label: 'Save Patch', sourceId: 'box-2' },
      { id: 'n6', type: 'checkpointer', label: 'Checkpoint' },
      { id: 'n7', type: 'mcp-call', label: 'Deploy', sourceId: 'github' },
      { id: 'n8', type: 'agent-action', label: 'Monitor', sourceId: 'agent-1' },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4' },
      { from: 'n4', to: 'n5' },
      { from: 'n4', to: 'n6' },
      { from: 'n6', to: 'n7' },
      { from: 'n7', to: 'n8' },
    ],
    createdAt: '2026-08-19',
  },
  {
    id: 'loop-3',
    name: 'Agent Skill Training Loop',
    description: 'Test an agent skill, evaluate outcome, read correction from Vault if failed, retry with fix. Converges on 3 consecutive successes.',
    status: 'draft',
    tag: 'graph-created',
    nodes: [
      { id: 'n1', type: 'vault-read', label: 'Skill Definition', sourceId: 'box-4' },
      { id: 'n2', type: 'agent-action', label: 'Test Skill', sourceId: 'agent-1' },
      { id: 'n3', type: 'verifier', label: 'Evaluate' },
      { id: 'n4', type: 'vault-read', label: 'Read Correction', sourceId: 'box-4' },
      { id: 'n5', type: 'agent-action', label: 'Retry with Fix', sourceId: 'agent-1' },
      { id: 'n6', type: 'checkpointer', label: 'Convergence Check' },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4' },
      { from: 'n4', to: 'n5' },
      { from: 'n5', to: 'n6' },
      { from: 'n6', to: 'n2' },
    ],
    createdAt: '2026-08-18',
  },
  {
    id: 'loop-4',
    name: '🌙 Byron → Midnight Auto-Work',
    description: 'Teaching example: Byron reads Midnight config from Vault, connects to Midnight City, activates auto-reply auto-work, verifies status, logs result. Shows how agent nodes + MCP nodes + condition gates work together.',
    status: 'draft',
    tag: 'custom',
    nodes: [
      { id: 'n1', type: 'vault-read', label: 'Read Midnight Config', sourceId: 'box-2' },
      { id: 'n2', type: 'mcp-call', label: 'Connect City', sourceId: 'midnight-city' },
      { id: 'n3', type: 'agent-action', label: 'Byron Auto-Reply', sourceId: 'agent-1' },
      { id: 'n4', type: 'mcp-call', label: 'Activate Auto-Work', sourceId: 'midnight-city' },
      { id: 'n5', type: 'mcp-call', label: 'Check Status', sourceId: 'midnight-city' },
      { id: 'n6', type: 'verifier', label: 'Verify Mining' },
      { id: 'n7', type: 'vault-write', label: 'Log Results', sourceId: 'box-5' },
      { id: 'n8', type: 'agent-action', label: 'Rest Agent', sourceId: 'agent-1' },
      { id: 'n9', type: 'checkpointer', label: 'End State' },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4' },
      { from: 'n4', to: 'n5' },
      { from: 'n5', to: 'n6' },
      { from: 'n6', to: 'n7' },
      { from: 'n7', to: 'n8' },
      { from: 'n8', to: 'n9' },
    ],
    createdAt: '2026-08-17',
  },
  {
    id: 'loop-5',
    name: 'Knowledge Discovery Loop',
    description: 'Continuously read from Vault, ask agent to analyze, expand search if gaps found, write enriched knowledge back. Stops when agent reports "sufficient".',
    status: 'draft',
    tag: 'custom',
    nodes: [
      { id: 'n1', type: 'vault-read', label: 'Read Topic', sourceId: 'box-3' },
      { id: 'n2', type: 'agent-action', label: 'Analyze', sourceId: 'agent-1' },
      { id: 'n3', type: 'verifier', label: 'Gap Check' },
      { id: 'n4', type: 'mcp-call', label: 'Expand Search', sourceId: 'web-search' },
      { id: 'n5', type: 'agent-action', label: 'Synthesize', sourceId: 'agent-1' },
      { id: 'n6', type: 'vault-write', label: 'Write Back', sourceId: 'box-3' },
      { id: 'n7', type: 'checkpointer', label: 'Converged?' },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4' },
      { from: 'n4', to: 'n5' },
      { from: 'n5', to: 'n6' },
      { from: 'n6', to: 'n7' },
      { from: 'n7', to: 'n1' },
    ],
    createdAt: '2026-08-16',
  },
  {
    id: 'loop-6',
    name: 'Multi-Agent Orchestration Loop',
    description: 'Read a complex task from Vault, fan out to multiple Mosaic AI Agents based on specialization, collect results, merge, and re-route incomplete sub-tasks. Converges when all branches report done.',
    status: 'draft',
    tag: 'graph-created',
    nodes: [
      { id: 'n1', type: 'vault-read', label: 'Read Task', sourceId: 'box-1' },
      { id: 'n2', type: 'agent-action', label: 'Planner', sourceId: 'agent-1' },
      { id: 'n3', type: 'agent-action', label: 'Coder Agent', sourceId: 'agent-2' },
      { id: 'n4', type: 'agent-action', label: 'Tester Agent', sourceId: 'agent-3' },
      { id: 'n5', type: 'mcp-call', label: 'Run Tests', sourceId: 'github' },
      { id: 'n6', type: 'verifier', label: 'All Done?' },
      { id: 'n7', type: 'vault-write', label: 'Merge Results', sourceId: 'box-1' },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n2', to: 'n4' },
      { from: 'n3', to: 'n5' },
      { from: 'n4', to: 'n5' },
      { from: 'n5', to: 'n6' },
      { from: 'n6', to: 'n7' },
    ],
    createdAt: '2026-08-15',
  },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-gray-800', text: 'text-gray-400' },
  running: { bg: 'bg-emerald-900/30', text: 'text-emerald-400' },
  paused: { bg: 'bg-amber-900/30', text: 'text-amber-400' },
  error: { bg: 'bg-red-900/30', text: 'text-red-400' },
};

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  'vault-read': <Box size={12} className="text-cyan-400" />,
  'vault-write': <Box size={12} className="text-cyan-400" />,
  'agent-action': <Bot size={12} className="text-purple-400" />,
  'mcp-call': <Server size={12} className="text-emerald-400" />,
  'checkpointer': <CheckCircle size={12} className="text-amber-400" />,
  'verifier': <AlertTriangle size={12} className="text-pink-400" />,
};

// ── Component ──────────────────────────────────────────────────────────────

const LoopsPanel: React.FC = () => {
  const [api, setApi] = useState<AddonAPI | null>(null);
  const [loops, setLoops] = useState<Loop[]>(() => {
    const saved = localStorage.getItem('stargate_loops_addon_v1');
    return saved ? JSON.parse(saved) : DEMO_LOOPS;
  });
  const [filter, setFilter] = useState<'all' | 'graph-created' | 'custom'>('all');
  const [selectedLoop, setSelectedLoop] = useState<Loop | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [mcps, setMcps] = useState<any[]>([]);
  const [boxes, setBoxes] = useState<any[]>([]);

  // Detect embedded mode
  useEffect(() => {
    const addonAPI = (window as any).addonAPI as AddonAPI | undefined;
    if (addonAPI?.mcp?.listServers) {
      setApi(addonAPI);
    }
  }, []);

  // Fetch live assets
  useEffect(() => {
    if (!api) return;
    Promise.all([
      api.agents?.list?.().catch(() => []),
      api.mcp?.listServers?.().catch(() => []),
    ]).then(([a, m]) => {
      if (a?.length) setAgents(a);
      if (m?.length) setMcps(m);
    });
  }, [api]);

  // Persist
  useEffect(() => {
    localStorage.setItem('stargate_loops_addon_v1', JSON.stringify(loops));
  }, [loops]);

  const filteredLoops = useMemo(() => {
    if (filter === 'all') return loops;
    return loops.filter(l => l.tag === filter);
  }, [loops, filter]);

  const handleDelete = (id: string) => {
    setLoops(prev => prev.filter(l => l.id !== id));
    if (selectedLoop?.id === id) {
      setSelectedLoop(null);
      setShowDetail(false);
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(loops, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loops-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string);
        if (Array.isArray(imported)) {
          setLoops(prev => [...imported, ...prev]);
        }
      } catch {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const isEmbedded = !!api;

  return (
    <div className="h-full w-full flex flex-col bg-gray-950">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-800 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch size={18} className="text-purple-400" />
              <h1 className="text-lg font-semibold text-white">Loop Designer</h1>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Design topologies · Validate · Export for execution</p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded flex items-center gap-1 cursor-pointer">
              <Upload size={12} /> Import
              <input type="file" accept=".json" className="hidden" onChange={handleImport} />
            </label>
            <button
              className="text-xs bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded flex items-center gap-1"
              onClick={() => setShowBuilder(true)}
            >
              <Plus size={12} /> New Loop
            </button>
          </div>
        </div>
      </div>

      {/* Bridge Missing Banner */}
      {!isEmbedded && (
        <div className="px-5 py-2 bg-amber-900/30 border-b border-amber-700/40">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-amber-300">
              No addon bridge detected — window.addonAPI not available. Showing demo data.
            </span>
          </div>
        </div>
      )}

      {/* ── Tabs + Filters ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <div className="flex items-center gap-1">
          {(['all', 'graph-created', 'custom'] as const).map(tag => (
            <button
              key={tag}
              className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                filter === tag
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              onClick={() => setFilter(tag)}
            >
              {tag === 'all' ? 'all' : tag}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span>{filteredLoops.length} designs</span>
          {isEmbedded && (
            <span className="text-[10px] text-gray-600">
              🔌 Live assets: {agents.length} agents · {mcps.length} MCPs · {boxes.length} boxes
            </span>
          )}
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Loop cards */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-4">
            {filteredLoops.map(loop => {
              const style = STATUS_COLORS[loop.status] || STATUS_COLORS.draft;
              return (
                <div
                  key={loop.id}
                  className={`bg-gray-900/50 border border-gray-800 hover:border-gray-700 rounded-lg p-4 cursor-pointer transition-all ${
                    selectedLoop?.id === loop.id ? 'ring-1 ring-purple-500/50' : ''
                  }`}
                  onClick={() => {
                    setSelectedLoop(loop);
                    setShowDetail(true);
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <GitBranch size={14} className="text-purple-400" />
                      <span className="text-sm font-medium text-gray-200">{loop.name}</span>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                      {loop.status}
                    </span>
                  </div>

                  <p className="text-xs text-gray-500 line-clamp-2 mb-3 leading-relaxed">{loop.description}</p>

                  <div className="flex items-center gap-3 text-[10px] text-gray-600">
                    <span className="flex items-center gap-1">
                      <Zap size={10} className="text-emerald-500" />
                      {loop.nodes.length} nodes
                    </span>
                    <span className="flex items-center gap-1">
                      <GitBranch size={10} className="text-purple-500" />
                      {loop.edges.length} edges
                    </span>
                    <span className={`text-[9px] px-1 rounded ${
                      loop.tag === 'graph-created' ? 'bg-cyan-900/30 text-cyan-400' : 'bg-amber-900/30 text-amber-400'
                    }`}>
                      {loop.tag}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredLoops.length === 0 && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center space-y-2">
                <GitBranch size={32} className="text-gray-700 mx-auto" />
                <p className="text-sm text-gray-500">No loops match this filter.</p>
                <button
                  className="text-xs text-purple-400 hover:text-purple-300"
                  onClick={() => setFilter('all')}
                >
                  Show all
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Detail Sidebar ────────────────────────────────────────────── */}
        {showDetail && selectedLoop && (
          <div className="w-80 border-l border-gray-800 bg-gray-900/30 overflow-y-auto">
            <div className="p-4 border-b border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-purple-400" />
                  <span className="text-sm font-semibold text-white">{selectedLoop.name}</span>
                </div>
                <button onClick={() => setShowDetail(false)}>
                  <X size={14} className="text-gray-500 hover:text-gray-300" />
                </button>
              </div>
              <p className="text-xs text-gray-500">{selectedLoop.description}</p>
            </div>

            {/* Topology */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Layers size={14} className="text-cyan-400" />
                <span className="text-xs font-medium text-gray-300">Topology</span>
                <span className="text-[10px] text-gray-600">{selectedLoop.nodes.length} nodes · {selectedLoop.edges.length} edges</span>
              </div>

              <div className="space-y-1.5">
                {selectedLoop.nodes.map((node, i) => (
                  <div key={node.id} className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0">
                      {NODE_TYPE_ICONS[node.type] || <Zap size={10} className="text-gray-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-200 truncate">{node.label}</div>
                      <div className="text-[9px] text-gray-600 uppercase">{node.type}{node.sourceId ? ` · ${node.sourceId}` : ''}</div>
                    </div>
                    {i < selectedLoop.nodes.length - 1 && (
                      <ChevronRight size={12} className="text-gray-700 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Live Assets (when embedded) */}
            {isEmbedded && (agents.length > 0 || mcps.length > 0 || boxes.length > 0) && (
              <div className="p-4 border-t border-gray-800">
                <div className="flex items-center gap-2 mb-2">
                  <Bot size={12} className="text-gray-400" />
                  <span className="text-[10px] font-medium text-gray-400 uppercase">Available Assets</span>
                </div>
                <div className="space-y-1">
                  {agents.map(a => (
                    <div key={`a-${a.id}`} className="flex items-center gap-1.5 text-[10px] text-purple-400">
                      <Bot size={9} /> {a.name || a.id}
                    </div>
                  ))}
                  {mcps.map(m => (
                    <div key={`m-${m.name}`} className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                      <Server size={9} /> {m.name}
                    </div>
                  ))}
                  {boxes.map(b => (
                    <div key={`b-${b.id}`} className="flex items-center gap-1.5 text-[10px] text-cyan-400">
                      <Box size={9} /> {b.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="p-4 border-t border-gray-800 space-y-2">
              <button className="w-full text-xs bg-purple-600 hover:bg-purple-500 text-white py-2 rounded flex items-center justify-center gap-1.5"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(selectedLoop, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${selectedLoop.name.toLowerCase().replace(/\s+/g, '-')}.loop.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={12} /> Export JSON
              </button>

              <button
                className="w-full text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded flex items-center justify-center gap-1.5"
                onClick={() => handleDelete(selectedLoop.id)}
              >
                <Trash2 size={12} className="text-red-400" /> Delete Loop
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Loop Builder Modal ────────────────────────────────────────── */}
      {showBuilder && (
        <LoopBuilderModal
          onClose={() => setShowBuilder(false)}
          onSave={(loop) => {
            const newLoop: Loop = {
              id: `loop-${Date.now()}`,
              name: loop.name || 'Untitled Loop',
              description: `Designed with ${loop.nodes.length} nodes and ${loop.edges.length} edges`,
              status: 'draft',
              tag: 'custom',
              nodes: loop.nodes.map((n: any) => ({
                id: n.id,
                type: n.type as LoopNode['type'],
                label: n.label,
              })),
              edges: loop.edges.map((e: any) => ({
                from: e.from,
                to: e.to,
              })),
              createdAt: new Date().toISOString().split('T')[0],
            };
            setLoops(prev => [newLoop, ...prev]);
            setSelectedLoop(newLoop);
            setShowBuilder(false);
            setShowDetail(true);
          }}
        />
      )}

      {/* ── StateManager Integration: Save loop state on selection ── */}
      {selectedLoop && (
        <button
          className="fixed bottom-4 right-4 z-40 text-xs bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-2 rounded shadow-lg flex items-center gap-1"
          onClick={async () => {
            if (!selectedLoop) return;
            await StateManager.saveState({
              loopId: selectedLoop.id,
              iteration: 0,
              goal: selectedLoop.description,
              lastOutcome: 'unknown',
              knownIssues: [],
              openQuestions: [],
              notes: `Saved from Loop Designer. Nodes: ${selectedLoop.nodes.length}, Edges: ${selectedLoop.edges.length}`,
              updatedAt: Date.now(),
            });
            await StateManager.saveVision({
              loopId: selectedLoop.id,
              destination: selectedLoop.description,
              successCondition: 'Loop executes end-to-end with all verifier nodes passing',
              antiGoal: 'Must never optimize for speed over correctness',
            });
            alert('Loop state saved to Vault!');
          }}
        >
          <Box size={12} /> Persist to Vault
        </button>
      )}
    </div>
  );
};

export default LoopsPanel;
