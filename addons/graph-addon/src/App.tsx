// =============================================================================
// GRAPH ADDON — App.tsx
// Standalone knowledge constellation for Stargate assets.
// Reads from addonAPI for live data; falls back to demo data for standalone review.
// =============================================================================

import React, { useEffect, useState } from 'react';
import GraphPanel from './components/graph/GraphPanel';

// ── Demo data for standalone review (when not embedded in Mosaic Companion) ──
const DEMO_BOXES = [
  { id: 'box-1', name: 'Invoice OCR', entryCount: 12, createdAt: '2026-08-20' },
  { id: 'box-2', name: 'Midnight Config', entryCount: 5, createdAt: '2026-08-19' },
  { id: 'box-3', name: 'MCP Registry', entryCount: 8, createdAt: '2026-08-18' },
  { id: 'box-4', name: 'Agent Skills', entryCount: 15, createdAt: '2026-08-17' },
  { id: 'box-5', name: 'Loop Designs', entryCount: 3, createdAt: '2026-08-16' },
];

const DEMO_ANFES = [
  { id: '4649559796048334', name: 'Node #1', type: 'Node' as const, source: 'node-manager', tokenId: '4649559796048334' },
  { id: '4649559796048335', name: 'Node #2', type: 'Node' as const, source: 'node-manager', tokenId: '4649559796048335' },
];

const App: React.FC = () => {
  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    // Detect if running inside Mosaic Companion (addon host)
    const api = (window as any).addonAPI;
    setIsEmbedded(!!api);
  }, []);

  return (
    <div className="h-screen w-screen bg-gray-950 text-gray-200 overflow-hidden">
      {/* Header */}
      <div className="h-12 border-b border-gray-800 flex items-center px-4 gap-3 bg-gray-900/50">
        <div className="flex items-center gap-2">
          <span className="text-cyan-400 font-bold">Stargate Graph</span>
          <span className="text-xs text-gray-500">v1.0.0</span>
        </div>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">
          {isEmbedded ? '🔌 Embedded in Mosaic Companion' : '📦 Standalone Review Mode'}
        </span>
      </div>

      {/* Graph Canvas */}
      <div className="flex-1 h-[calc(100vh-48px)]">
        <GraphPanel />
      </div>
    </div>
  );
};

export default App;
