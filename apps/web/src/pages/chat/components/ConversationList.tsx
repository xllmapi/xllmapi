import { useMemo } from "react";
import { ConversationItem } from "./ConversationItem";
import { useLocale } from "@/hooks/useLocale";
import type { Conversation } from "../hooks/useChatStore";

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string;
  searchQuery: string;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

interface Group {
  label: string;
  items: Conversation[];
}

function groupConversations(conversations: Conversation[], t: (key: string) => string): Group[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  const todayItems: Conversation[] = [];
  const yesterdayItems: Conversation[] = [];
  const thisWeekItems: Conversation[] = [];
  const earlierItems: Conversation[] = [];

  for (const conv of conversations) {
    const d = new Date(conv.updatedAt || conv.createdAt);
    if (d >= today) todayItems.push(conv);
    else if (d >= yesterday) yesterdayItems.push(conv);
    else if (d >= weekAgo) thisWeekItems.push(conv);
    else earlierItems.push(conv);
  }

  const result: Group[] = [];
  if (todayItems.length) result.push({ label: t("chat.sidebar.today"), items: todayItems });
  if (yesterdayItems.length) result.push({ label: t("chat.sidebar.yesterday"), items: yesterdayItems });
  if (thisWeekItems.length) result.push({ label: t("chat.sidebar.thisWeek"), items: thisWeekItems });
  if (earlierItems.length) result.push({ label: t("chat.sidebar.earlier"), items: earlierItems });
  return result;
}

export function ConversationList({ conversations, activeId, searchQuery, onSelect, onRename, onDelete }: ConversationListProps) {
  const { t } = useLocale();

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        (c.title || "").toLowerCase().includes(q) ||
        (c.lastMessage || "").toLowerCase().includes(q)
    );
  }, [conversations, searchQuery]);

  const groups = useMemo(() => groupConversations(filtered, t), [filtered, t]);

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold px-3 py-2 mt-1">
            {group.label}
          </div>
          {group.items.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              active={activeId === conv.id}
              onClick={() => onSelect(conv.id)}
              onRename={(title) => onRename(conv.id, title)}
              onDelete={() => onDelete(conv.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
