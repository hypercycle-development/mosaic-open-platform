// =============================================================================
// COMPUTE PORTAL ADDON — App.tsx
// Standalone marketplace iframe wrapper.
// Reads from addonAPI for wallet context; falls back to standalone review mode.
// =============================================================================

import React, { useEffect, useState } from 'react';
import ComputePortalPanel from './components/compute-portal/ComputePortalPanel';

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
          <span className="text-[#00FF88] font-bold">Compute Portal</span>
          <span className="text-xs text-gray-500">v1.0.0</span>
        </div>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">
          {isEmbedded ? '🔌 Embedded in Mosaic Companion' : '📦 Standalone Review Mode'}
        </span>
      </div>

      {/* Portal Content */}
      <div className="flex-1 h-[calc(100vh-48px)]">
        <ComputePortalPanel />
      </div>
    </div>
  );
};

export default App;
