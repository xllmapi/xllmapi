import { type ReactNode } from "react";
import { CopyButton } from "@/components/ui/CopyButton";

interface CodeBlockProps {
  className?: string;
  children?: ReactNode;
}

export function CodeBlock({ className, children }: CodeBlockProps) {
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

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}
