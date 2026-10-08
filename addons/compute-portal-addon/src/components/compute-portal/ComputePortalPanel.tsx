// =============================================================================
// COMPUTE PORTAL ADDON — Simplified iframe wrapper for addon system
// No main process entry. Renders inside addon webview via mosaic-addon:// protocol.
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
  AlertTriangle,
} from "lucide-react";

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const COMPUTE_PORTAL_URL = "https://computeportal.io/r/CP-2B9535B3";
const RETRY_DELAYS = [3000, 6000, 12000];

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
interface AddonAPI {
  getWalletAddress?(): string;
  openExternal?(url: string): void;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function useEmbeddedMode(): { embedded: boolean; walletAddress?: string } {
  return useMemo(() => {
    const win = window as any;
    const api: AddonAPI | undefined = win.addonAPI;
    const embedded = Boolean(api && api.getWalletAddress);
    const walletAddress = api?.getWalletAddress?.();
    return { embedded, walletAddress };
  }, []);
}

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------
const AddonHeader: React.FC<{ embedded: boolean; walletAddress?: string }> = ({ embedded, walletAddress }) => (
  <div className="flex items-center justify-between px-4 py-2 bg-[#0a0a0f] border-b border-[#00FF88]/20">
    <div className="flex items-center gap-3">
      <Server className="w-5 h-5 text-[#00FF88]" />
      <span className="font-semibold text-[#00FF88] text-sm tracking-wide">Compute Portal</span>
      {embedded && (
        <span className="px-2 py-0.5 text-[10px] rounded bg-[#00FF88]/10 text-[#00FF88] border border-[#00FF88]/30">embedded</span>
      )}
    </div>
    <div className="flex items-center gap-3">
      {walletAddress && (
        <span className="text-[10px] text-[#00FF88]/60 font-mono">
          {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
        </span>
      )}
      <a
        href={COMPUTE_PORTAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-[#00FF88]/70 hover:text-[#00FF88] text-xs transition-colors"
      >
        <ExternalLink className="w-3 h-3" /> Open in Browser
      </a>
    </div>
  </div>
);

const LoadingOverlay: React.FC = () => (
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#050709] z-20">
    <Loader2 className="w-8 h-8 text-[#00FF88] animate-spin mb-3" />
    <span className="text-[#00FF88] text-sm">Loading Compute Portal…</span>
    <span className="text-[#00FF88]/50 text-xs mt-1">affiliate: CP-2B9535B3</span>
  </div>
);

const ErrorState: React.FC<{ error: string; onRetry: () => void }> = ({ error, onRetry }) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#050709] z-20 p-6">
    <div className="flex items-center gap-2 mb-3 text-amber-400">
      <AlertTriangle className="w-6 h-6" />
      <span className="text-sm font-medium">Failed to load Compute Portal</span>
    </div>
    <p className="text-amber-400/70 text-xs text-center max-w-md mb-4">{error}</p>
    <div className="flex items-center gap-3">
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#0a0a0f] bg-[#00FF88] hover:bg-[#00FF88]/90 rounded transition-colors"
      >
        <RefreshCw className="w-3 h-3" /> Retry
      </button>
      <a
        href={COMPUTE_PORTAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#00FF88] border border-[#00FF88]/30 hover:bg-[#00FF88]/10 rounded transition-colors"
      >
        <ExternalLink className="w-3 h-3" /> Open in Browser
      </a>
    </div>
  </div>
);

// ------------------------------------------------------------------
// Main Panel
// ------------------------------------------------------------------
export default function ComputePortalPanel() {
  const { embedded, walletAddress } = useEmbeddedMode();
  const online = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [key, setKey] = useState(0);

  const url = useMemo(() => {
    const u = new URL(COMPUTE_PORTAL_URL);
    if (walletAddress) u.searchParams.set("wallet", walletAddress);
    if (embedded) u.searchParams.set("embed", "mosaic");
    return u.toString();
  }, [walletAddress, embedded]);

  const handleRetry = () => {
    setError(null);
    setLoading(true);
    setRetryCount((c) => c + 1);
    setKey((k) => k + 1);
  };

  const handleError = (msg: string) => {
    setLoading(false);
    if (retryCount < RETRY_DELAYS.length) {
      setTimeout(handleRetry, RETRY_DELAYS[retryCount]);
    } else {
      setError(msg);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    setRetryCount(0);
  }, [url]);

  return (
    <div className="flex flex-col h-full w-full bg-[#050709]">
      <AddonHeader embedded={embedded} walletAddress={walletAddress} />

      <div className="relative flex-1 overflow-hidden">
        {loading && <LoadingOverlay />}
        {error && <ErrorState error={error} onRetry={handleRetry} />}

        <iframe
          key={key}
          src={url}
          title="Compute Portal"
          className={`w-full h-full border-none ${loading || error ? 'opacity-0' : 'opacity-100'}`}
          allow="payment"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={() => setLoading(false)}
          onError={() => handleError('iframe failed to load')}
        />
      </div>
    </div>
  );
}
