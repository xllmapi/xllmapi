import { type ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { CopyButton } from "@/components/ui/CopyButton";

interface CodeBlockProps {
  className?: string;
  children?: ReactNode;
  isStreaming?: boolean;
}

export function CodeBlock({ className, children, isStreaming }: CodeBlockProps) {
  const match = /language-(\w+)/.exec(className ?? "");
  const lang = match?.[1];
  const code = extractText(children);

  // Inline code (no language class)
  if (!lang) {
    return (
      <code className="bg-panel border border-line rounded-[4px] px-1.5 py-0.5 text-xs font-mono text-accent">
        {children}
      </code>
    );
  }

  // Mermaid diagram
  if (lang === "mermaid") {
    return <MermaidBlock code={code} isStreaming={isStreaming} />;
  }

  // Block code
  return (
    <div className="rounded-[var(--radius-card)] border border-line overflow-hidden my-3 not-first:mt-0">
      <div className="flex justify-between items-center px-4 py-2 bg-panel-strong border-b border-line">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">
          {lang}
        </span>
        <CopyButton text={code} label="Copy" copiedLabel="Copied!" className="!px-2 !py-0.5 !text-[10px]" />
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-xs font-mono leading-relaxed max-h-[500px] overflow-y-auto bg-bg-0 m-0">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

// Module-level cache — survives remounts, stores SVG + user's view/zoom/pan
const mermaidCache = new Map<string, { svg: string; error: string; view: "source" | "diagram"; zoom: number; panX: number; panY: number }>();
const mermaidRendering = new Set<string>();

function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const cacheKey = code.trim();
  const cached = mermaidCache.get(cacheKey);
  const [svg, setSvg] = useState(cached?.svg ?? "");
  const [error, setError] = useState(cached?.error ?? "");
  const [view, _setView] = useState<"source" | "diagram">(cached?.view ?? (cached?.svg ? "diagram" : "source"));
  const [zoom, _setZoom] = useState(cached?.zoom ?? 1);
  const [pan, _setPan] = useState({ x: cached?.panX ?? 0, y: cached?.panY ?? 0 });
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const persist = useCallback(() => {
    const c = mermaidCache.get(cacheKey);
    if (c) { c.zoom = zoom; c.panX = pan.x; c.panY = pan.y; }
  }, [cacheKey, zoom, pan]);

  const setView = (v: "source" | "diagram") => {
    _setView(v);
    const c = mermaidCache.get(cacheKey);
    if (c) c.view = v;
  };

  // Native wheel listener — must be non-passive to call preventDefault
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!focused) return; // only zoom in focus mode
      e.preventDefault();
      e.stopPropagation();
      const next = Math.min(Math.max(zoomRef.current + (e.deltaY < 0 ? 0.1 : -0.1), 0.3), 3);
      _setZoom(next);
      const c = mermaidCache.get(cacheKey);
      if (c) c.zoom = next;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [focused, cacheKey]);

  const handleMouseLeave = useCallback(() => {
    setFocused(false);
    if (dragging) { setDragging(false); persist(); }
  }, [dragging, persist]);

  // Mouse down: enter focus + start drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setFocused(true);
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    _setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    if (dragging) { setDragging(false); persist(); }
  }, [dragging, persist]);

  const resetView = () => {
    _setZoom(1); _setPan({ x: 0, y: 0 });
    const c = mermaidCache.get(cacheKey);
    if (c) { c.zoom = 1; c.panX = 0; c.panY = 0; }
  };

  // Render exactly once per unique code, only after streaming ends
  useEffect(() => {
    if (isStreaming) return;
    if (mermaidCache.has(cacheKey)) {
      // Already rendered — use cache on remount, don't touch view
      const c = mermaidCache.get(cacheKey)!;
      if (c.svg && !svg) setSvg(c.svg);
      return;
    }
    if (mermaidRendering.has(cacheKey)) return;
    mermaidRendering.add(cacheKey);

    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            darkMode: true,
            background: "#0a0d14",
            primaryColor: "#1a2233",
            primaryTextColor: "#c8d1e0",
            primaryBorderColor: "rgba(136,154,196,0.2)",
            lineColor: "#8be3da",
            secondaryColor: "#141b2d",
            tertiaryColor: "#1a2233",
          },
        });
        const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
        const { svg: rendered } = await mermaid.render(id, cacheKey);
        mermaidCache.set(cacheKey, { svg: rendered, error: "", view: "diagram", zoom: 1, panX: 0, panY: 0 });
        if (!cancelled) {
          setSvg(rendered);
          setError("");
          _setView("diagram");
        }
      } catch (e) {
        const errStr = String(e);
        mermaidCache.set(cacheKey, { svg: "", error: errStr, view: "source", zoom: 1, panX: 0, panY: 0 });
        if (!cancelled) setError(errStr);
      } finally {
        mermaidRendering.delete(cacheKey);
      }
    })();
    return () => { cancelled = true; };
  }, [isStreaming]); // only depend on isStreaming, cacheKey is stable for same code

  return (
    <div className="rounded-[var(--radius-card)] border border-line overflow-hidden my-3">
      <div className="flex justify-between items-center px-4 py-2 bg-panel-strong border-b border-line">
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">mermaid</span>
          <div className="flex items-center bg-bg-0 rounded p-0.5 ml-2">
            <button
              onClick={() => setView("diagram")}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors cursor-pointer ${
                view === "diagram" ? "bg-panel text-text-primary" : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              Diagram
            </button>
            <button
              onClick={() => setView("source")}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors cursor-pointer ${
                view === "source" ? "bg-panel text-text-primary" : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              Source
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {view === "diagram" && svg && (
            <>
              {focused ? (
                <span className="text-[9px] text-accent">🔍 {Math.round(zoom * 100)}%</span>
              ) : (
                <span className="text-[9px] text-text-tertiary">{Math.round(zoom * 100)}%</span>
              )}
              {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
                <button onClick={resetView} className="text-[9px] text-text-tertiary hover:text-accent cursor-pointer px-1">Reset</button>
              )}
            </>
          )}
          <CopyButton text={code} label="Copy" copiedLabel="Copied!" className="!px-2 !py-0.5 !text-[10px]" />
        </div>
      </div>

      {view === "diagram" ? (
        <div
          ref={containerRef}
          className={`overflow-hidden bg-bg-0 min-h-[60px] max-h-[600px] select-none transition-shadow ${focused ? "ring-1 ring-accent/40" : ""}`}
          style={{ cursor: dragging ? "grabbing" : focused ? "grab" : "default" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <div
            className="p-4 flex justify-center"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: dragging ? "none" : "transform 0.15s ease",
            }}
          >
            {svg ? (
              <div dangerouslySetInnerHTML={{ __html: svg }} className="mermaid-svg [&_svg]:max-w-full pointer-events-none" />
            ) : error ? (
              <pre className="text-xs text-danger/70 whitespace-pre-wrap">{error}</pre>
            ) : (
              <span className="text-xs text-text-tertiary">Rendering…</span>
            )}
          </div>
        </div>
      ) : (
        <pre className="overflow-x-auto px-4 py-3 text-xs font-mono leading-relaxed max-h-[500px] overflow-y-auto bg-bg-0 m-0">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}
