import { createContext, useContext, type ReactNode } from "react";
import { useChatStore } from "@/pages/chat/hooks/useChatStore";

type ChatStore = ReturnType<typeof useChatStore>;

const ChatContext = createContext<ChatStore | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const store = useChatStore();
  return <ChatContext.Provider value={store}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatStore {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
}
