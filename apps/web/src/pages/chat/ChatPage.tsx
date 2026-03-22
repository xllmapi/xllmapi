import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PanelLeftOpen } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ChatSidebar } from "./components/ChatSidebar";
import { ChatMain } from "./components/ChatMain";
import { useChat } from "@/hooks/useChatContext";

export function ChatPage() {
  const store = useChat();
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Load all conversations on mount (model selector only affects new chat creation)
  useEffect(() => {
    if (isLoggedIn) {
      void store.loadConversations();
    }
  }, [isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load messages when active conversation changes
  useEffect(() => {
    void store.loadMessages(store.activeId);
  }, [store.activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewChat = useCallback(() => {
    if (!isLoggedIn) { navigate("/auth"); return; }
    void store.createConversation();
  }, [store.createConversation, isLoggedIn, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(() => {
    if (!isLoggedIn) { navigate("/auth"); return; }
    void store.sendMessage(store.input);
  }, [store.sendMessage, store.input, isLoggedIn, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePromptClick = useCallback((text: string) => {
    store.setInput(text);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 top-[56px] flex overflow-hidden">
      {/* Sidebar toggle (shown when collapsed on desktop) */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="hidden md:flex fixed left-3 top-[72px] z-[40] w-8 h-8 items-center justify-center rounded-[var(--radius-btn)] bg-panel border border-line text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}

      {/* Mobile toggle */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="md:hidden fixed left-3 top-[72px] z-[40] w-8 h-8 flex items-center justify-center rounded-[var(--radius-btn)] bg-panel border border-line text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors"
      >
        <PanelLeftOpen className="w-4 h-4" />
      </button>

      <ChatSidebar
        model={store.model}
        onModelChange={store.setModel}
        conversations={store.conversations}
        activeId={store.activeId}
        onSelect={store.setActiveId}
        onNewChat={handleNewChat}
        onRename={(id, title) => void store.renameConversation(id, title)}
        onDelete={(id) => void store.deleteConversation(id)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <ChatMain
        messages={store.messages}
        model={store.model}
        input={store.input}
        onInputChange={store.setInput}
        onSend={handleSend}
        onStop={store.stopGeneration}
        onRetry={store.retryLastMessage}
        onPromptClick={handlePromptClick}
        streaming={store.streaming}
        metaMap={store.metaMap}
      />
    </div>
  );
}
