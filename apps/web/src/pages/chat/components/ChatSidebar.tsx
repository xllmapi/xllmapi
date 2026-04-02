import { useState } from "react";
import { PanelLeftClose, Plus, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { ModelSelector } from "@/components/shared/ModelSelector";
import { ConversationList } from "./ConversationList";
import { useLocale } from "@/hooks/useLocale";
import { useAuth } from "@/hooks/useAuth";
import type { Conversation } from "../hooks/useChatStore";

interface ChatSidebarProps {
  model: string;
  onModelChange: (m: string) => void;
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  open: boolean;
  onClose: () => void;
}

export function ChatSidebar({
  model, onModelChange, conversations, activeId,
  onSelect, onNewChat, onRename, onDelete,
  open, onClose,
}: ChatSidebarProps) {
  const { t } = useLocale();
  const { isLoggedIn } = useAuth();
  const [search, setSearch] = useState("");

  const content = (
    <div className="flex flex-col h-full bg-bg-1 border-r border-line">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-line">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          {t("chat.sidebar.title")}
        </span>
        <button
          onClick={onClose}
          className="p-1 text-text-tertiary hover:text-text-secondary bg-transparent border-none cursor-pointer transition-colors"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* Model selector */}
      <div className="p-3 border-b border-line">
        <ModelSelector
          value={model}
          onChange={onModelChange}
          className="w-full"
        />
      </div>

      {/* New chat button */}
      {isLoggedIn && (
        <div className="px-3 pt-3">
          <button
            onClick={onNewChat}
            disabled={!model}
            className="w-full flex items-center justify-center gap-1.5 rounded-[var(--radius-btn)] bg-accent-bg text-accent text-sm py-2 cursor-pointer border border-accent/20 hover:bg-accent/15 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("chat.newChat")}
          </button>
        </div>
      )}

      {/* Search (show when >5 conversations) */}
      {isLoggedIn && conversations.length > 5 && (
        <div className="px-3 pt-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("chat.sidebar.search")}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-[var(--radius-input)] border border-line bg-transparent text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/40 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Conversation list */}
      {isLoggedIn && (
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          searchQuery={search}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}

      {/* Footer */}
      {isLoggedIn && (
        <div className="p-3 border-t border-line">
          <Link
            to="/app"
            className="text-text-tertiary text-xs no-underline hover:text-text-secondary transition-colors"
          >
            {t("chat.backToDashboard")}
          </Link>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:block shrink-0 relative transition-[width] duration-200 ease-in-out overflow-hidden"
        style={{ width: open ? 260 : 0 }}
      >
        <div className="w-[260px] h-full">{content}</div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/40 z-[69]"
            onClick={onClose}
          />
          <aside className="md:hidden fixed left-0 bottom-0 w-[260px] z-[70]" style={{ top: "var(--header-height, 56px)" }}>
            {content}
          </aside>
        </>
      )}
    </>
  );
}
