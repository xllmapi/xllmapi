import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { Conversation } from "../hooks/useChatStore";
import { useLocale } from "@/hooks/useLocale";

interface ConversationItemProps {
  conversation: Conversation;
  active: boolean;
  onClick: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function ConversationItem({ conversation, active, onClick, onRename, onDelete }: ConversationItemProps) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-cancel confirm after 3s
  useEffect(() => {
    if (confirming) {
      confirmTimer.current = setTimeout(() => setConfirming(false), 3000);
      return () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); };
    }
  }, [confirming]);

  const modelName = conversation.model || conversation.logicalModel || "?";
  const title = conversation.title || t("chat.untitled");

  const handleStartRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(conversation.title || "");
    setEditing(true);
    setConfirming(false);
  };

  const handleFinishRename = () => {
    if (editTitle.trim()) {
      onRename(editTitle.trim());
    }
    setEditing(false);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(true);
  };

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
    onDelete();
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
  };

  // Confirming state: show inline confirmation bar
  if (confirming) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2.5 bg-danger/10 border-l-2 border-danger transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <Trash2 className="w-3.5 h-3.5 text-danger shrink-0" />
        <span className="flex-1 text-xs text-danger truncate">{t("chat.deleteConfirm")}</span>
        <button
          onClick={handleConfirmDelete}
          className="p-1 rounded-[var(--radius-btn)] bg-danger/20 text-danger hover:bg-danger/30 border-none cursor-pointer transition-colors"
          title={t("chat.delete")}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleCancelDelete}
          className="p-1 rounded-[var(--radius-btn)] bg-panel text-text-tertiary hover:text-text-secondary border-none cursor-pointer transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors relative ${
        active
          ? "bg-accent/10 border-l-2 border-accent"
          : "border-l-2 border-transparent hover:bg-accent-bg"
      }`}
      onClick={onClick}
    >
      {/* Model avatar */}
      <span className="shrink-0 w-7 h-7 rounded-[var(--radius-avatar)] bg-accent/15 flex items-center justify-center text-accent text-[11px] font-bold mt-0.5">
        {modelName.charAt(0).toUpperCase()}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleFinishRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleFinishRename();
              if (e.key === "Escape") setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent border-b border-accent text-sm text-text-primary outline-none py-0"
          />
        ) : (
          <div className="text-sm text-text-primary truncate">{title}</div>
        )}
        {conversation.lastMessage && !editing && (
          <div className="text-xs text-text-tertiary truncate mt-0.5">
            {conversation.lastMessage.slice(0, 40)}
          </div>
        )}
      </div>

      {/* Time + actions */}
      <div className="shrink-0 flex flex-col items-end gap-1">
        <span className="text-[10px] text-text-tertiary">
          {relativeTime(conversation.updatedAt || conversation.createdAt)}
        </span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleStartRename}
            className="p-0.5 text-text-tertiary hover:text-accent bg-transparent border-none cursor-pointer transition-colors"
            title={t("chat.rename")}
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={handleDeleteClick}
            className="p-0.5 text-text-tertiary hover:text-danger bg-transparent border-none cursor-pointer transition-colors"
            title={t("chat.delete")}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
