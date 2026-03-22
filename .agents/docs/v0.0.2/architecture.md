# xllmapi v0.0.2 Architecture

## System Overview

```
Browser / API Client
        │
┌───────▼────────────────────────────────────────────┐
│  platform-api (Node.js)  :3000                      │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Auth+Session │  │ Provider CRUD│  │ Chat + SSE │ │
│  └─────────────┘  └──────┬───────┘  └─────┬──────┘ │
│                          │                 │         │
│                ┌─────────▼─────────────────▼──────┐ │
│                │      Provider Executor            │ │
│                │  ┌──────────┐ ┌────────────────┐ │ │
│                │  │ Circuit  │ │  Concurrency   │ │ │
│                │  │ Breaker  │ │  Limiter (32)  │ │ │
│                │  └──────────┘ └────────────────┘ │ │
│                │  ┌──────────┐ ┌────────────────┐ │ │
│                │  │  Retry   │ │ Offering       │ │ │
│                │  │ (3x exp) │ │ Fallback       │ │ │
│                │  └──────────┘ └────────────────┘ │ │
│                └──────────┬───────────────────────┘ │
│                           │                          │
│              ┌────────────┼────────────┐             │
│              ▼            ▼            ▼             │
│         ┌────────┐  ┌─────────┐  ┌──────────┐      │
│         │ OpenAI │  │Anthropic│  │ OAI-     │      │
│         │        │  │         │  │compat    │      │
│         └────┬───┘  └────┬────┘  └────┬─────┘      │
│              │           │            │              │
└──────────────┼───────────┼────────────┼──────────────┘
               ▼           ▼            ▼
          api.openai.com  api.anthropic.com
          api.deepseek.com  api.minimaxi.com  ...
```

## Provider System

### Supported Providers (v0.0.2)

| Provider | Type | Base URL | Models |
|----------|------|----------|--------|
| DeepSeek | openai_compatible | api.deepseek.com | deepseek-chat, deepseek-reasoner |
| OpenAI | openai | api.openai.com/v1 | gpt-4o-mini, gpt-4o |
| Anthropic | anthropic | api.anthropic.com/v1 | claude-sonnet-4-20250514 |
| MiniMax | openai_compatible | api.minimaxi.com/v1 | MiniMax-M2.7, MiniMax-M2.5, MiniMax-Text-01 |

### Model Discovery Flow

```
User selects provider
        │
User enters API key
        │ (600ms debounce)
        ▼
POST /v1/provider-models ──► Provider /v1/models
        │                           │
        ▼                           ▼
   ok: true ───────────► Show discovered models (API badge)
   ok: false ──────────► Fallback to preset models
        │
User selects models + Submit
        │
        ▼
POST /v1/provider-credentials (validate + create)
        │
        ▼
POST /v1/offerings × N (one per model)
```

### Provider Executor Pipeline

```
Request ──► Concurrency Limiter (32 max)
                │
                ▼
        Filter by Circuit Breaker (skip open circuits)
                │
                ▼
        Shuffle offerings (balanced routing)
                │
                ▼
        For each offering:
          ├─ Decrypt API key (AES-256-GCM)
          ├─ Resolve base URL
          ├─ Call provider with retry (3x, 250ms exp backoff)
          │    ├─ Success → record circuit success → return
          │    └─ Fail → record circuit failure → try next
          └─ All failed → return error
```

## Frontend Architecture

### Chat Message Rendering

```
ChatMessageList
  ├─ Auto-scroll logic (smart follow)
  │   ├─ Near bottom (< 80px) → auto-scroll
  │   ├─ User scrolled up → pause auto-scroll
  │   ├─ Streaming starts → reset to auto-scroll
  │   └─ Float button: "跟随输出" / "回到底部"
  │
  ├─ ChatMessage × N
  │   ├─ parseThinking(content)
  │   │   ├─ <think> found, unclosed → {thinking, isThinking: true}
  │   │   ├─ <think>...</think> found → {thinking, answer}
  │   │   └─ No <think> → {answer: content}
  │   │
  │   ├─ ThinkingBlock (collapsible)
  │   │   ├─ Streaming: expanded + spinner + "思考中…"
  │   │   └─ Done: collapsed "▶ 思考过程", click to expand
  │   │
  │   └─ Markdown content (react-markdown + remark-gfm + rehype-highlight)
  │
  └─ TypingIndicator (during streaming)
```

### Network Page (Provider Key Submission)

```
┌──────────────────────────────┐
│ 选择 API 厂商                 │  ← Provider dropdown (by id)
│ [DeepSeek ▼]                 │
├──────────────────────────────┤
│ Provider API Key              │  ← Password input
│ [••••••••••••••••]           │
├──────────────────────────────┤
│ ⟳ 查询中… / 4 可用模型        │  ← Auto-discover status
├──────────────────────────────┤
│ 选择接受调用的模型             │
│ ☑ deepseek-chat      [API]   │  ← Discovered model
│ ☐ deepseek-reasoner  [API]   │
├──────────────────────────────┤
│ [自定义模型名称____] [添加]    │  ← Manual model input
├──────────────────────────────┤
│ [提交]  验证 Key… ⟳           │  ← Step status inline
│         创建模型节点… ⟳        │
│         接入成功 ✓             │
└──────────────────────────────┘
```

## Error Handling

### Global ErrorBoundary (App.tsx)
- React class component wrapping entire app
- Catches any unhandled render errors
- Shows error message + Reload button instead of blank screen

### Numeric Safety
- All DB values may come as strings; `Number()` wrapper on all display values
- `formatTokens()` threshold at 999,950 for M unit (prevents 1000.0K display)

## Data Model Changes (v0.0.2)

### New Fields
- `credentialCount` added to model listing SQL (COUNT DISTINCT credential_id)
- `ownerCount` used for "node" display on homepage (unique users per model)

### API Response Additions
- `GET /v1/models` response now includes `credentialCount` per model
- `POST /v1/provider-models` — new endpoint for dynamic model discovery

## File Structure (v0.0.2 additions)

```
apps/platform-api/src/
├── core/
│   ├── circuit-breaker.ts      # Per-offering failure tracking
│   ├── concurrency-limiter.ts  # Promise semaphore (32 max)
│   ├── provider-executor.ts    # Main orchestrator + fallback
│   ├── retry.ts                # Exponential backoff (3x, 250ms)
│   ├── sse-parser.ts           # SSE stream parser
│   └── providers/
│       ├── openai.ts           # OpenAI + OAI-compatible
│       └── anthropic.ts        # Anthropic Claude
├── services/
│   └── platform-service.ts     # +discoverProviderModels(), +MiniMax presets
└── main.ts                     # +POST /v1/provider-models

apps/web/src/
├── App.tsx                     # +ErrorBoundary wrapper
├── lib/
│   └── utils.ts                # formatTokens() threshold fix
├── pages/
│   ├── ModelsPage.tsx           # ownerCount for node stats
│   ├── app/
│   │   └── NetworkPage.tsx      # Auto-discover + step status
│   └── chat/
│       └── components/
│           ├── ChatMessage.tsx   # parseThinking() + ThinkingBlock
│           └── ChatMessageList.tsx  # Smart scroll + float button
```
