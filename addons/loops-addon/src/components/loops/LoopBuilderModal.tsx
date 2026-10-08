// =============================================================================
// LOOP BUILDER MODAL — Full drag-and-drop canvas (replaces 104-line stub)
// Gap-mapped: #4 Evaluator, #7 Goal-based stopping, #10 Optimizer
// Node-edge canvas with real dependency validation
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, GitBranch, ArrowRight, Play, Download, Trash2, Save } from 'lucide-react';

// ── Extended Node Types (gap-mapped) ────────────────────────────────────────

interface NodeTypeDef {
  id: string;
  label: string;
  color: string;
  bg: string;
  border: string;
  description: string;
  gap?: number; // which gap this addresses
}

const NODE_TYPES: NodeTypeDef[] = [
  { id: 'vault-read',    label: 'Vault Read',    color: 'text-cyan-400',    bg: 'bg-cyan-900/20',    border: 'border-cyan-700',    description: 'Read data from Mosaic Vault box' },
  { id: 'vault-write',   label: 'Vault Write',   color: 'text-cyan-400',    bg: 'bg-cyan-900/20',    border: 'border-cyan-700',    description: 'Write results to Mosaic Vault' },
  { id: 'agent-action',  label: 'Agent Action',  color: 'text-purple-400',  bg: 'bg-purple-900/20',  border: 'border-purple-700',  description: 'Execute action on a Mosaic AI Agent' },
  { id: 'mcp-call',      label: 'MCP Call',      color: 'text-emerald-400', bg: 'bg-emerald-900/20', border: 'border-emerald-700', description: 'Call an MCP server tool' },
  { id: 'checkpointer',  label: 'Checkpoint',    color: 'text-amber-400',   bg: 'bg-amber-900/20',   border: 'border-amber-700',   description: 'Save loop state for resume' },
  { id: 'verifier',      label: 'Verifier',      color: 'text-pink-400',    bg: 'bg-pink-900/20',    border: 'border-pink-700',    description: 'Assert condition must hold' },
  { id: 'evaluator',     label: 'Evaluator',     color: 'text-rose-400',    bg: 'bg-rose-900/20',    border: 'border-rose-700',    description: 'Fresh model reviews output (Gap #4)', gap: 4 },
  { id: 'optimizer',     label: 'Optimizer',     color: 'text-orange-400',  bg: 'bg-orange-900/20',  border: 'border-orange-700',  description: 'Refine strategy from performance (Gap #10)', gap: 10 },
  { id: 'scheduler',     label: 'Scheduler',     color: 'text-indigo-400',  bg: 'bg-indigo-900/20',  border: 'border-indigo-700',  description: 'Priority queue for tasks (Gap #3)', gap: 3 },
  { id: 'memory',        label: 'Memory',        color: 'text-sky-400',     bg: 'bg-sky-900/20',     border: 'border-sky-700',     description: 'Persist learnings across runs (Gap #2)', gap: 2 },
  { id: 'parallel',      label: 'Parallel Fan',  color: 'text-lime-400',    bg: 'bg-lime-900/20',    border: 'border-lime-700',    description: 'Fan out to multiple branches' },
  { id: 'merge',         label: 'Merge Barrier', color: 'text-teal-400',    bg: 'bg-teal-900/20',    border: 'border-teal-700',    description: 'Wait for all branches + aggregate' },
  { id: 'goal-stop',     label: 'Goal Stop',     color: 'text-fuchsia-400', bg: 'bg-fuchsia-900/20', border: 'border-fuchsia-700', description: 'Run until condition met (Gap #7)', gap: 7 },
];

// ── Canvas Types ─────────────────────────────────────────────────────────────

interface CanvasNode {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasEdge {
  id: string;
  from: string;
  to: string;
}

interface LoopBuilderModalProps {
  onClose: () => void;
  onSave?: (loop: any) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

const NODE_W = 140;
const NODE_H = 50;

const LoopBuilderModal: React.FC<LoopBuilderModalProps> = ({ onClose, onSave }) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [loopName, setLoopName] = useState('');
  const nextId = useRef(1);

  // ── Drag from palette ──────────────────────────────────────────────────
  const handlePaletteDragStart = (e: React.DragEvent, type: NodeTypeDef) => {
    e.dataTransfer.setData('application/json', JSON.stringify(type));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const typeDef: NodeTypeDef = JSON.parse(raw);
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - NODE_W / 2;
    const y = e.clientY - rect.top - NODE_H / 2;
    const newNode: CanvasNode = {
      id: `n-${nextId.current++}`,
      type: typeDef.id,
      label: typeDef.label,
      x,
      y,
      width: NODE_W,
      height: NODE_H,
    };
    setNodes(prev => [...prev, newNode]);
  };

  // ── Drag existing node ───────────────────────────────────────────────────
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId)!;
    setDragOffset({ x: e.clientX - node.x, y: e.clientY - node.y });
    setDraggingNodeId(nodeId);
    setSelectedNodeId(nodeId);
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingNodeId) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left - dragOffset.x;
      const y = e.clientY - rect.top - dragOffset.y;
      setNodes(prev => prev.map(n => n.id === draggingNodeId ? { ...n, x: Math.max(0, x), y: Math.max(0, y) } : n));
    };
    const onMouseUp = () => setDraggingNodeId(null);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [draggingNodeId, dragOffset]);

  // ── Connect nodes ────────────────────────────────────────────────────────
  const handleNodeClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (!connectingFrom) {
      setConnectingFrom(nodeId);
    } else if (connectingFrom !== nodeId) {
      const exists = edges.some(ed => ed.from === connectingFrom && ed.to === nodeId);
      if (!exists) {
        setEdges(prev => [...prev, { id: `e-${nextId.current++}`, from: connectingFrom, to: nodeId }]);
      }
      setConnectingFrom(null);
    } else {
      setConnectingFrom(null);
    }
  };

  // Click canvas to deselect
  const handleCanvasClick = () => {
    setConnectingFrom(null);
    setSelectedNodeId(null);
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes(prev => prev.filter(n => n.id !== selectedNodeId));
    setEdges(prev => prev.filter(e => e.from !== selectedNodeId && e.to !== selectedNodeId));
    setSelectedNodeId(null);
  }, [selectedNodeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected]);

  // ── Validation (real dependency check — Gap #1) ──────────────────────────
  const validate = useCallback(() => {
    const errors: string[] = [];
    // Check for orphaned nodes
    nodes.forEach(n => {
      const hasEdge = edges.some(e => e.from === n.id || e.to === n.id);
      if (!hasEdge && nodes.length > 1) errors.push(`Orphaned node: ${n.label}`);
    });
    // Check for cycles (simple)
    const visited = new Set<string>();
    const recurse = (id: string, path: Set<string>) => {
      if (path.has(id)) { errors.push('Cycle detected in graph'); return; }
      if (visited.has(id)) return;
      visited.add(id);
      path.add(id);
      edges.filter(e => e.from === id).forEach(e => recurse(e.to, new Set(path)));
    };
    nodes.forEach(n => recurse(n.id, new Set()));
    // Check parallel → merge pairing
    const parallelNodes = nodes.filter(n => n.type === 'parallel');
    const mergeNodes = nodes.filter(n => n.type === 'merge');
    if (parallelNodes.length !== mergeNodes.length) {
      errors.push(`Parallel/Merge mismatch: ${parallelNodes.length} parallel vs ${mergeNodes.length} merge`);
    }
    setValidationErrors(errors);
  }, [nodes, edges]);

  useEffect(() => { validate(); }, [nodes, edges, validate]);

  // ── Export ───────────────────────────────────────────────────────────────
  const exportJSON = () => {
    const payload = {
      name: loopName || 'Untitled Loop',
      nodes: nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
      edges: edges.map(e => ({ from: e.from, to: e.to })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${loopName || 'loop'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getNodeDef = (typeId: string) => NODE_TYPES.find(nt => nt.id === typeId) || NODE_TYPES[0];

  const getEdgePath = (fromId: string, toId: string) => {
    const from = nodes.find(n => n.id === fromId);
    const to = nodes.find(n => n.id === toId);
    if (!from || !to) return '';
    const fx = from.x + from.width / 2;
    const fy = from.y + from.height / 2;
    const tx = to.x + to.width / 2;
    const ty = to.y + to.height / 2;
    // Bezier curve
    const cx = (fx + tx) / 2;
    return `M ${fx} ${fy} C ${cx} ${fy}, ${cx} ${ty}, ${tx} ${ty}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-[95vw] h-[90vh] flex overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Left Sidebar: Node Palette ── */}
        <div className="w-64 border-r border-gray-800 flex flex-col bg-gray-950">
          <div className="p-3 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <GitBranch size={16} className="text-purple-400" />
              Node Palette
            </h2>
            <p className="text-[10px] text-gray-500 mt-1">Drag onto canvas</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {NODE_TYPES.map(nt => (
              <div
                key={nt.id}
                draggable
                onDragStart={e => handlePaletteDragStart(e, nt)}
                className={`p-2 rounded border ${nt.bg} ${nt.border} cursor-grab active:cursor-grabbing hover:opacity-80 transition`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${nt.color}`}>{nt.label}</span>
                  {nt.gap && <span className="text-[9px] bg-gray-800 px-1 rounded text-gray-400">Gap #{nt.gap}</span>}
                </div>
                <p className="text-[9px] text-gray-500 mt-0.5 leading-tight">{nt.description}</p>
              </div>
            ))}
          </div>
          {/* Validation Panel */}
          <div className="p-2 border-t border-gray-800">
            <p className="text-[10px] font-medium text-gray-400 mb-1">Validation</p>
            {validationErrors.length === 0 ? (
              <p className="text-[10px] text-emerald-400">✅ All checks pass</p>
            ) : (
              <div className="space-y-0.5">
                {validationErrors.map((err, i) => (
                  <p key={i} className="text-[10px] text-amber-400">⚠️ {err}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Center: Canvas ── */}
        <div className="flex-1 flex flex-col">
          {/* Toolbar */}
          <div className="h-10 border-b border-gray-800 flex items-center px-3 gap-2 bg-gray-900/50">
            <input
              value={loopName}
              onChange={e => setLoopName(e.target.value)}
              placeholder="Loop name..."
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white w-48 focus:outline-none focus:border-purple-500"
            />
            <div className="flex-1" />
            {connectingFrom && (
              <span className="text-[10px] text-purple-300 bg-purple-900/30 px-2 py-0.5 rounded">
                Click target node to connect
              </span>
            )}
            <button onClick={exportJSON} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-800">
              <Download size={14} /> Export JSON
            </button>
            {onSave && (
              <button onClick={() => onSave({ name: loopName, nodes, edges })} className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded hover:bg-emerald-900/20">
                <Save size={14} /> Save
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={16} />
            </button>
          </div>

          {/* Canvas */}
          <div
            ref={canvasRef}
            className="flex-1 relative bg-gray-950 overflow-hidden"
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={handleCanvasDrop}
            onClick={handleCanvasClick}
          >
            {/* Grid pattern */}
            <div
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: 'radial-gradient(circle, #475569 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}
            />

            {/* Edges SVG layer */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <defs>
                <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                  <polygon points="0 0, 6 2, 0 4" fill="#64748b" />
                </marker>
              </defs>
              {edges.map(edge => (
                <path
                  key={edge.id}
                  d={getEdgePath(edge.from, edge.to)}
                  stroke="#64748b"
                  strokeWidth="1.5"
                  fill="none"
                  markerEnd="url(#arrowhead)"
                  className="opacity-60"
                />
              ))}
              {/* Connection line while dragging */}
              {connectingFrom && (
                <circle
                  cx={nodes.find(n => n.id === connectingFrom)?.x}
                  cy={nodes.find(n => n.id === connectingFrom)?.y}
                  r="4"
                  fill="#a855f7"
                  className="animate-pulse"
                />
              )}
            </svg>

            {/* Nodes */}
            {nodes.map(node => {
              const def = getNodeDef(node.type);
              const isSelected = selectedNodeId === node.id;
              const isConnectingSource = connectingFrom === node.id;
              return (
                <div
                  key={node.id}
                  onMouseDown={e => handleNodeMouseDown(e, node.id)}
                  onClick={e => handleNodeClick(e, node.id)}
                  className={`absolute select-none cursor-move flex flex-col items-center justify-center rounded border ${def.bg} ${def.border} transition-all duration-75 ${isSelected ? 'ring-2 ring-purple-500' : ''} ${isConnectingSource ? 'ring-2 ring-amber-400' : ''}`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                  }}
                >
                  <span className={`text-[10px] font-semibold ${def.color}`}>{node.label}</span>
                  <span className="text-[8px] text-gray-500">{node.id}</span>
                  {def.gap && (
                    <span className="absolute -top-1.5 -right-1.5 text-[7px] bg-gray-800 text-purple-300 px-1 rounded border border-gray-700">
                      #{def.gap}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Empty state */}
            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-gray-600">
                  <GitBranch size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Drag nodes from the palette to build your loop</p>
                  <p className="text-xs mt-1">Click a node, then click another to connect</p>
                </div>
              </div>
            )}

            {/* Stats overlay */}
            <div className="absolute bottom-3 right-3 bg-gray-900/80 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-400">
              {nodes.length} nodes · {edges.length} edges
              {validationErrors.length > 0 && ` · ${validationErrors.length} issue${validationErrors.length > 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoopBuilderModal;
