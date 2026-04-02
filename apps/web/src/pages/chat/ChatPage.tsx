import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PanelLeftOpen } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ChatSidebar } from "./components/ChatSidebar";
import { ChatMain } from "./components/ChatMain";
import { useChat } from "@/hooks/useChatContext";
import { useUserModels } from "@/hooks/useUserModels";

export function ChatPage() {
  const store = useChat();
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isModelAvailable, hasUserList } = useUserModels();
  const [modelWarning, setModelWarning] = useState<string | null>(null);

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

  // Only warn about model availability when no active conversation (new chat mode)
  useEffect(() => {
    if (store.activeId || !store.model || !hasUserList) { setModelWarning(null); return; }
    if (!isModelAvailable(store.model)) {
      setModelWarning(store.model);
    } else {
      setModelWarning(null);
    }
  }, [store.model, store.activeId, isModelAvailable, hasUserList]);

  // Listen for MODEL_UNAVAILABLE errors from the store (backend rejection)
  useEffect(() => {
    if (store.error?.startsWith("MODEL_UNAVAILABLE:")) {
      const modelName = store.error.split(":")[1] || store.model || "";
      setModelWarning(modelName);
      store.setError(null);
    }
  }, [store.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(() => {
    if (!isLoggedIn) { navigate("/auth"); return; }
    // Only check model availability for NEW conversations (no activeId)
    // Existing conversations use their own bound model
    if (!store.activeId && hasUserList && store.model && !isModelAvailable(store.model)) {
      setModelWarning(store.model);
      return;
    }
    setModelWarning(null);
    void store.sendMessage(store.input);
  }, [store.sendMessage, store.input, store.model, store.activeId, isLoggedIn, navigate, isModelAvailable, hasUserList]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePromptClick = useCallback((text: string) => {
    store.setInput(text);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 flex overflow-hidden" style={{ top: "var(--header-height, 56px)" }}>
      {/* Sidebar toggle (shown when collapsed on desktop) */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="hidden md:flex fixed left-3 top-[calc(var(--header-height,56px)+16px)] z-[40] w-8 h-8 items-center justify-center rounded-[var(--radius-btn)] bg-panel border border-line text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}

      {/* Mobile toggle */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden fixed left-3 top-[calc(var(--header-height,56px)+16px)] z-[40] w-8 h-8 flex items-center justify-center rounded-[var(--radius-btn)] bg-panel border border-line text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}

      <ChatSidebar
        model={store.model}
        onModelChange={store.setModel}
        conversations={store.conversations}
        activeId={store.activeId}
        onSelect={(id) => { store.setActiveId(id); if (window.innerWidth < 768) setSidebarOpen(false); }}
        onNewChat={handleNewChat}
        onRename={(id, title) => void store.renameConversation(id, title)}
        onDelete={(id) => void store.deleteConversation(id)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Model not in usage list warning */}
        {modelWarning && (
          <div className="mx-4 mt-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-3">
            <span className="text-xs text-amber-400">
              模型 <strong>{modelWarning}</strong> 不在你的使用列表中，请先到模型网络添加。
            </span>
            <button
              onClick={() => navigate("/mnetwork")}
              className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors cursor-pointer shrink-0"
            >
              去添加
            </button>
          </div>
        )}
        <ChatMain
          messages={store.messages}
          model={store.conversations.find((c) => c.id === store.activeId)?.model || store.conversations.find((c) => c.id === store.activeId)?.logicalModel || store.model}
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
    </div>
  );
}
