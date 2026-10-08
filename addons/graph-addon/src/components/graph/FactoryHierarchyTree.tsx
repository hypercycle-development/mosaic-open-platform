import React, { useMemo } from "react";

interface LicenseNode {
  tokenId: string;
  level: number;
  status?: "current" | "good" | "fair" | "low" | "no-data";
  hasData?: boolean;
}

const LICENSE_CHAIN: LicenseNode[] = [
  { tokenId: "9081171476656",       level: 19, status: "no-data" },
  { tokenId: "18162342953313",      level: 18, status: "no-data" },
  { tokenId: "36324685906627",      level: 17, status: "no-data" },
  { tokenId: "72649371813255",      level: 16, status: "no-data" },
  { tokenId: "145298743626510",     level: 15, status: "no-data" },
  { tokenId: "290597487253020",     level: 14, status: "no-data" },
  { tokenId: "581194974506041",     level: 13, status: "no-data" },
  { tokenId: "1162389949012083",    level: 12, status: "no-data" },
  { tokenId: "2324779898024167",    level: 11, status: "no-data" },
  { tokenId: "4649559796048334",    level: 10, status: "current", hasData: true },
];

const STATUS_COLORS: Record<string, string> = {
  current: "#22c55e",
  good:    "#22c55e",
  fair:    "#eab308",
  low:     "#ef4444",
  "no-data": "#9ca3af",
};

const CARD_BORDER: Record<string, string> = {
  current: "border-green-500 bg-green-900/20",
  good:    "border-green-500/50 bg-gray-800/40",
  fair:    "border-yellow-500/50 bg-gray-800/40",
  low:     "border-red-500/50 bg-gray-800/40",
  "no-data": "border-gray-600 bg-gray-800/40",
};

export default function FactoryHierarchyTree() {
  const nodes = useMemo(() => LICENSE_CHAIN, []);
  const stepX = 48;
  const stepY = 72;
  const totalWidth = 600;
  const totalHeight = nodes.length * stepY + 80;

  return (
    <div className="h-full w-full overflow-auto bg-[#0a0f1a] text-gray-300">
      <div className="relative mx-auto" style={{ width: totalWidth, minHeight: totalHeight }}>
        <svg className="absolute inset-0 pointer-events-none" width={totalWidth} height={totalHeight}>
          {nodes.map((node, i) => {
            if (i === 0) return null;
            const prev = nodes[i - 1];
            const x1 = 24 + (19 - prev.level) * stepX + 8;
            const y1 = 40 + (i - 1) * stepY + 24;
            const x2 = 24 + (19 - node.level) * stepX + 8;
            const y2 = 40 + i * stepY + 8;
            return (
              <line
                key={`conn-${i}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="#4b5563"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            );
          })}
        </svg>

        <div className="relative z-10 pt-6 pb-8">
          {nodes.map((node, i) => {
            const left = 24 + (19 - node.level) * stepX;
            const top = 40 + i * stepY;
            const color = STATUS_COLORS[node.status || "no-data"];
            const cardClass = CARD_BORDER[node.status || "no-data"];

            return (
              <div
                key={node.tokenId}
                className={`absolute rounded-lg border px-4 py-2 shadow-lg transition-transform hover:scale-105 ${cardClass}`}
                style={{ left, top, minWidth: 220 }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full border-2 border-white/30 flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono font-semibold text-gray-100 truncate">
                      {node.tokenId}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Level {node.level}
                      {node.status === "current" && (
                        <span className="ml-2 text-green-400 font-bold">CURRENT</span>
                      )}
                      {!node.hasData && node.status !== "current" && (
                        <span className="ml-2 text-gray-500">• no data</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-6 text-xs text-gray-400">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" /> Current</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500/60" /> Good 95%+</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500" /> Fair 80%+</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> Low</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-400" /> No data</span>
        </div>
      </div>
    </div>
  );
}
