"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphEdge, GraphNode, SubGraph } from "@/lib/brainApi";

// react-force-graph touches `window` at import time, so it must not be part of
// the server bundle.
const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d") as unknown as Promise<React.ComponentType<any>>,
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-bg-inset" /> },
);

type FgNode = GraphNode & { x?: number; y?: number; fx?: number; fy?: number };

type Props = {
  data: SubGraph;
  highlight?: Set<string>;
  /** Ids to pulse one after another — the traversal path of the last answer. */
  traverse?: string[];
  onNodeClick?: (node: GraphNode) => void;
  showLabels?: boolean;
};

const REL_COLORS: Record<string, string> = {
  DEPENDS_ON: "#ef4444",
  BLOCKED_BY: "#f97316",
  KNOWS_ABOUT: "#0ea5e9",
  RELATES_TO: "#64748b",
  AUTHORED: "#a855f7",
  MENTIONS: "#94a3b8",
  DISCUSSED_IN: "#94a3b8",
};

export function GraphCanvas({
  data,
  highlight,
  traverse,
  onNodeClick,
  showLabels = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [pulseIndex, setPulseIndex] = useState(-1);
  const graphRef = useRef<any>(null);

  // react-force-graph mutates the node objects it is given; clone so the
  // caller's state is not corrupted across renders.
  const graphData = useMemo(() => {
    const nodes: FgNode[] = data.nodes.map((n) => ({ ...n }));
    const ids = new Set(nodes.map((n) => n.id));
    const links: GraphEdge[] = data.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ ...e }));
    return { nodes, links };
  }, [data]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(width, 200), h: Math.max(height, 200) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Walk the traversal path so the user sees the order the agent reasoned in.
  useEffect(() => {
    if (!traverse || traverse.length === 0) {
      setPulseIndex(-1);
      return;
    }
    setPulseIndex(0);
    const timer = setInterval(() => {
      setPulseIndex((i) => {
        if (i >= traverse.length - 1) {
          clearInterval(timer);
          return i;
        }
        return i + 1;
      });
    }, 420);
    return () => clearInterval(timer);
  }, [traverse]);

  const paint = useCallback(() => {
    const fg = graphRef.current;
    if (!fg) return;
    const ctx = fg?.ctx?.();
    if (!ctx) return;

    // Edges
    const links = graphData.links as any[];
    for (const link of links) {
      const s = link.source as FgNode;
      const t = link.target as FgNode;
      if (s?.x == null || t?.x == null) continue;
      const active = highlight?.has(s.id) && highlight?.has(t.id);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = active ? REL_COLORS[link.type] ?? "#94a3b8" : "rgba(148,163,184,0.28)";
      ctx.lineWidth = active ? 1.9 : 0.8;
      ctx.stroke();
    }

    // Nodes
    const nodes = graphData.nodes as FgNode[];
    nodes.forEach((node) => {
      if (node.x == null || node.y == null) return;
      const dim = highlight && highlight.size > 0 && !highlight.has(node.id);
      const pulsing = traverse?.[pulseIndex] === node.id;
      const r = pulsing ? 9 : node.label === "Service" ? 7 : 5.5;

      if (pulsing) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 6, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(250, 204, 21, 0.22)";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = dim ? "rgba(100,116,139,0.35)" : node.color || "#64748b";
      ctx.fill();
      if (highlight?.has(node.id) && !dim) {
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (showLabels && (!dim || size.w > 520)) {
        ctx.font = "10px ui-monospace, monospace";
        ctx.fillStyle = dim ? "rgba(148,163,184,0.5)" : "rgba(30,41,59,0.9)";
        ctx.fillText(String(node.name).slice(0, 22), node.x + r + 3, node.y + 3);
      }
    });
  }, [graphData, highlight, traverse, pulseIndex, showLabels, size.w]);

  if (data.nodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted">
        No contributing subgraph yet — ask a question to populate it.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full">
      <ForceGraph2D
        ref={graphRef as any}
        width={size.w}
        height={size.h}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={4}
        linkColor={() => "rgba(148,163,184,0.3)"}
        linkWidth={1}
        cooldownTicks={90}
        d3AlphaDecay={0.04}
        d3VelocityDecay={0.3}
        nodeCanvasObjectMode={() => () => paint()}
        linkCanvasObjectMode={() => () => paint()}
        onNodeClick={(node: FgNode) => onNodeClick?.(node)}
        onNodeHover={(node: FgNode | null) => {
          if (containerRef.current) {
            containerRef.current.style.cursor = node ? "pointer" : "default";
          }
        }}
      />
    </div>
  );
}

export function Legend({
  labels,
  active,
  onToggle,
}: {
  labels: { label: string; color: string }[];
  active?: Set<string>;
  onToggle?: (label: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((l) => (
        <button
          key={l.label}
          onClick={() => onToggle?.(l.label)}
          className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition ${
            active && active.size > 0 && !active.has(l.label)
              ? "border-border opacity-40"
              : "border-border bg-bg-elevated"
          }`}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: l.color }}
            aria-hidden
          />
          {l.label}
        </button>
      ))}
    </div>
  );
}
