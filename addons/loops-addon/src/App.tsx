// =============================================================================
// LOOPS ADDON — App.tsx
// Standalone loop designer. Reads from addonAPI for live data; falls back to demo.
// =============================================================================

import React, { useEffect, useState } from 'react';
import LoopsPanel from './components/loops/LoopsPanel';

const DEMO_LOOPS = [
  {
    id: 'loop-1',
    name: 'Invoice Processing',
    description: 'OCR → Validate → Upload to ERP',
    status: 'draft' as const,
    nodes: [
      { id: 'n1', type: 'vault-read', label: 'Read Invoice' },
      { id: 'n2', type: 'mcp-call', label: 'OCR Extraction' },
      { id: 'n3', type: 'agent-action', label: 'Validate Data' },
      { id: 'n4', type: 'mcp-call', label: 'ERP Upload' },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4' },
    ],
    createdAt: '2026-08-20',
  },
  {
    id: 'loop-2',
    name: 'Social Media Monitor',
    description: 'Scrape → Sentiment → Alert',
    status: 'draft' as const,
    nodes: [
      { id: 'n1', type: 'mcp-call', label: 'Scrape Posts' },
      { id: 'n2', type: 'agent-action', label: 'Score Sentiment' },
      { id: 'n3', type: 'mcp-call', label: 'Send Alert' },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
    ],
    createdAt: '2026-08-19',
  },
];

const App: React.FC = () => {
  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    const api = (window as any).addonAPI;
    setIsEmbedded(!!api);
  }, []);

  return (
    <div className="h-screen w-screen bg-gray-950 text-gray-200 overflow-hidden">
      {/* Header */}
      <div className="h-12 border-b border-gray-800 flex items-center px-4 gap-3 bg-gray-900/50">
        <div className="flex items-center gap-2">
          <span className="text-purple-400 font-bold">Stargate Loops</span>
          <span className="text-xs text-gray-500">v1.0.0</span>
        </div>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">
          {isEmbedded ? '🔌 Embedded in Mosaic Companion' : '📦 Standalone Review Mode'}
        </span>
      </div>

      {/* Loops Canvas */}
      <div className="flex-1 h-[calc(100vh-48px)]">
        <LoopsPanel />
      </div>
    </div>
  );
};

export default App;
