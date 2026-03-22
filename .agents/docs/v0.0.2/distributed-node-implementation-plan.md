# Distributed Node Network — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to run local nodes that connect to the xllmapi platform via WebSocket, keeping API keys local while the platform handles routing and settlement.

**Architecture:** Thin Relay over WebSocket. Nodes connect outbound to platform, receive request dispatches, execute LLM calls locally, stream responses back. Platform handles all business logic (routing, settlement, reputation).

**Tech Stack:** TypeScript/Node.js, `ws` library for WebSocket, PostgreSQL migrations, existing ESM patterns with `.js` imports.

**Spec:** `.agents/docs/v0.0.2/distributed-node-network.md`

---

## Phase 1: Foundation — DB Schema + Shared Types

### Task 1.1: Database Migration

**Files:**
- Create: `infra/sql/postgres/008_node_network.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- 008_node_network.sql
-- Distributed Node Network tables

-- Node authentication tokens
CREATE TABLE IF NOT EXISTS node_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hashed_token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Node instances (one per WS connection)
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL REFERENCES node_tokens(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offline',
  last_heartbeat_at TIMESTAMPTZ,
  capabilities JSONB NOT NULL DEFAULT '[]',
  ip_address TEXT,
  user_agent TEXT,
  connected_at TIMESTAMPTZ,
  reputation_score REAL NOT NULL DEFAULT 1.0,
  total_requests_served BIGINT NOT NULL DEFAULT 0,
  total_success_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Extend offerings for node execution
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL;

-- Consumer node preferences
CREATE TABLE IF NOT EXISTS user_node_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  allow_distributed_nodes BOOLEAN NOT NULL DEFAULT FALSE,
  trust_mode TEXT NOT NULL DEFAULT 'all',
  trusted_supplier_ids JSONB NOT NULL DEFAULT '[]',
  trusted_offering_ids JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Consumer connection pool (opt-in to specific offerings)
CREATE TABLE IF NOT EXISTS user_connection_pool (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, offering_id)
);

-- Votes (upvote/downvote per offering)
CREATE TABLE IF NOT EXISTS offering_votes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('upvote', 'downvote')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, offering_id)
);

-- Favorites
CREATE TABLE IF NOT EXISTS offering_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, offering_id)
);

-- Comments
CREATE TABLE IF NOT EXISTS offering_comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_nodes_user_status ON nodes (user_id, status);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes (status);
CREATE INDEX IF NOT EXISTS idx_offerings_node ON offerings (node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offerings_execution_mode ON offerings (execution_mode, logical_model, enabled, review_status);
CREATE INDEX IF NOT EXISTS idx_node_tokens_user ON node_tokens (user_id, status);
CREATE INDEX IF NOT EXISTS idx_offering_votes_offering ON offering_votes (offering_id, vote);
CREATE INDEX IF NOT EXISTS idx_offering_favorites_offering ON offering_favorites (offering_id);
CREATE INDEX IF NOT EXISTS idx_offering_comments_offering ON offering_comments (offering_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_connection_pool_offering ON user_connection_pool (offering_id);
```

- [ ] **Step 2: Apply migration to dev database**

Run: `./scripts/dev-up.sh` (auto-applies migrations)
Or manually: `node apps/platform-api/dist/scripts/apply-postgres-migrations.js`

- [ ] **Step 3: Commit**

```bash
git add infra/sql/postgres/008_node_network.sql
git commit -m "feat: add node network DB migration (008)"
```

### Task 1.2: Extend Shared Types

**Files:**
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Add node-related types to shared-types**

Add to `packages/shared-types/src/index.ts`:
- Extend `CandidateOffering` with `executionMode` and `nodeId`
- Add `NodeCapability` interface
- Add WS message type definitions
- Add node protocol constants

- [ ] **Step 2: Build shared-types**

Run: `npm run build --workspace @xllmapi/shared-types`

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/index.ts
git commit -m "feat: add node network types to shared-types"
```

### Task 1.3: Add `ws` dependency

**Files:**
- Modify: `apps/platform-api/package.json`

- [ ] **Step 1: Install ws**

Run: `npm install ws --workspace @xllmapi/platform-api`

- [ ] **Step 2: Commit**

```bash
git add apps/platform-api/package.json package-lock.json
git commit -m "feat: add ws dependency for node WebSocket support"
```

---

## Phase 2: Platform Backend — Node Token CRUD + Repository

### Task 2.1: Repository Interface — Node Methods

**Files:**
- Modify: `apps/platform-api/src/repositories/platform-repository.ts`

- [ ] **Step 1: Add node method signatures to PlatformRepository type**

Methods to add:
```typescript
// Node tokens
createNodeToken(params: { userId: string; label: string }): MaybePromise<{ id: string; rawToken: string }>;
listNodeTokens(userId: string): MaybePromise<any[]>;
revokeNodeToken(params: { userId: string; tokenId: string }): MaybePromise<boolean>;
authenticateNodeToken(rawToken: string): MaybePromise<{ userId: string; tokenId: string } | null>;

// Nodes
upsertNode(params: { nodeId: string; userId: string; tokenId: string; ipAddress?: string; capabilities: any[] }): MaybePromise<void>;
updateNodeStatus(params: { nodeId: string; status: string; lastHeartbeatAt?: string }): MaybePromise<void>;
listUserNodes(userId: string): MaybePromise<any[]>;
getNode(nodeId: string): MaybePromise<any | null>;
listOnlineNodes(): MaybePromise<any[]>;

// Node offerings
findOfferingsForModelWithNodes(params: { logicalModel: string; userId: string }): MaybePromise<any[]>;

// Node preferences
getNodePreferences(userId: string): MaybePromise<any | null>;
upsertNodePreferences(params: { userId: string; allowDistributedNodes: boolean; trustMode: string; trustedSupplierIds: string[]; trustedOfferingIds: string[] }): MaybePromise<void>;
```

- [ ] **Step 2: Commit**

### Task 2.2: PostgreSQL Implementation — Node Methods

**Files:**
- Modify: `apps/platform-api/src/repositories/postgres-platform-repository.ts`

- [ ] **Step 1: Implement createNodeToken**

Generate `ntok_` prefixed token, SHA256 hash, insert into `node_tokens`.

- [ ] **Step 2: Implement listNodeTokens, revokeNodeToken, authenticateNodeToken**

- [ ] **Step 3: Implement upsertNode, updateNodeStatus, listUserNodes, getNode, listOnlineNodes**

- [ ] **Step 4: Implement findOfferingsForModelWithNodes**

Extended version of `findOfferingsForModel` that also returns node offerings with online status filtering.

- [ ] **Step 5: Implement getNodePreferences, upsertNodePreferences**

- [ ] **Step 6: Commit**

### Task 2.3: SQLite Stub Implementation

**Files:**
- Modify: `apps/platform-api/src/repositories/sqlite-platform-repository.ts`

- [ ] **Step 1: Add stub implementations that return empty arrays / null**

SQLite is dev-only and can return empty data for node features initially.

- [ ] **Step 2: Commit**

---

## Phase 3: Platform Backend — Node Routes + Service Layer

### Task 3.1: Node Route Handler

**Files:**
- Modify: `apps/platform-api/src/routes/node.ts` (extend existing or create)

- [ ] **Step 1: Implement node token CRUD routes**

```
POST   /v1/nodes/tokens          — create token
GET    /v1/nodes/tokens          — list my tokens
DELETE /v1/nodes/tokens/:id      — revoke token
```

- [ ] **Step 2: Implement node listing routes**

```
GET    /v1/nodes                 — list my nodes
GET    /v1/nodes/:id/stats       — node stats
```

- [ ] **Step 3: Implement consumer preference routes**

```
GET    /v1/me/node-preferences         — get preferences
PUT    /v1/me/node-preferences         — update preferences
```

- [ ] **Step 4: Wire routes in main.ts**

Add `handleNodeRoutes` to the route dispatch chain.

- [ ] **Step 5: Commit**

### Task 3.2: Service Layer — Node Business Logic

**Files:**
- Modify: `apps/platform-api/src/services/platform-service.ts`

- [ ] **Step 1: Add node token service methods**

`createNodeToken()`, `listNodeTokens()`, `revokeNodeToken()`

- [ ] **Step 2: Add node management methods**

`registerNode()`, `updateNodeHeartbeat()`, `listMyNodes()`, `getNodeStats()`

- [ ] **Step 3: Add preference methods**

`getNodePreferences()`, `updateNodePreferences()`

- [ ] **Step 4: Commit**

---

## Phase 4: WebSocket Connection Manager

### Task 4.1: NodeConnectionManager

**Files:**
- Create: `apps/platform-api/src/core/node-connection-manager.ts`

- [ ] **Step 1: Implement NodeConnectionManager class**

```typescript
class NodeConnectionManager {
  // Map<nodeId, WebSocket>
  private connections: Map<string, WebSocket>;
  // Map<requestId, { resolve, reject, timeout }>
  private pendingRequests: Map<string, PendingRequest>;

  handleUpgrade(req, socket, head): void  // WS upgrade
  handleConnection(ws, userId, tokenId): void  // Auth + register
  dispatch(nodeId, requestId, payload, onSseWrite): Promise<ProviderResult>  // Send request
  handleMessage(nodeId, message): void  // Route incoming messages
  startHeartbeat(): void  // 30s ping loop
  disconnectNode(nodeId): void  // Cleanup
}
```

- [ ] **Step 2: Implement auth flow**

On WS connect: receive `auth` message → validate token via `authenticateNodeToken()` → send `auth.ok` or `auth.error` → register connection.

- [ ] **Step 3: Implement heartbeat**

30s `ping` from platform → node responds `pong` with metrics → 10s timeout → disconnect if no pong.

- [ ] **Step 4: Implement capabilities handling**

Node sends `capabilities` → platform stores in DB via `upsertNode()`.

- [ ] **Step 5: Implement request dispatch**

`dispatch()`: send `request` message over WS → listen for `response.delta` / `response.done` / `response.error` → 120s timeout → return `ProviderResult`.

- [ ] **Step 6: Commit**

### Task 4.2: Wire WebSocket to HTTP Server

**Files:**
- Modify: `apps/platform-api/src/main.ts`

- [ ] **Step 1: Add WS upgrade handler**

After `createServer()`, before `server.listen()`:
```typescript
import { nodeConnectionManager } from './core/node-connection-manager.js';
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  if (url.pathname === '/ws/node') {
    nodeConnectionManager.handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});
```

- [ ] **Step 2: Commit**

---

## Phase 5: Provider Executor Integration

### Task 5.1: Add Node Execution Branch

**Files:**
- Modify: `apps/platform-api/src/core/provider-executor.ts`

- [ ] **Step 1: Add node dispatch branch in executeStreamingRequest**

Inside the offering loop, add:
```typescript
if (offering.executionMode === 'node') {
  const result = await nodeConnectionManager.dispatch(
    offering.nodeId, params.requestId, {
      model: offering.realModel,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      stream: true,
    },
    params.onSseWrite
  );
  // ... return ProviderResult
}
```

- [ ] **Step 2: Update findOfferingsForModel call in chat.ts**

Modify `chat.ts` to use `findOfferingsForModelWithNodes()` with user's node preferences.

- [ ] **Step 3: Commit**

### Task 5.2: Model Verification Flow

**Files:**
- Modify: `apps/platform-api/src/core/node-connection-manager.ts`

- [ ] **Step 1: Implement verifyNodeModel()**

When node sends capabilities, platform sends a test request ("Hello") for each model → check response format and timing → store verification status.

- [ ] **Step 2: Commit**

---

## Phase 6: Node CLI Package

### Task 6.1: Scaffold node-cli Package

**Files:**
- Create: `apps/node-cli/package.json`
- Create: `apps/node-cli/tsconfig.json`
- Create: `apps/node-cli/src/main.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@xllmapi/node-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "xllmapi-node": "./dist/main.js" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

- [ ] **Step 3: Create main.ts — CLI entry with arg parsing**

Parse: `--token`, `--platform-url`, `--provider`, `--api-key`, `--base-url`, `--local-ollama`, `--local-vllm`

- [ ] **Step 4: Commit**

### Task 6.2: WebSocket Client

**Files:**
- Create: `apps/node-cli/src/ws-client.ts`

- [ ] **Step 1: Implement WsClient class**

```typescript
class WsClient {
  connect(platformUrl, token): void
  reconnect(): void  // Exponential backoff 1s..60s
  handleMessage(data): void  // Route by message type
  sendAuth(token): void
  sendCapabilities(models): void
  sendPong(metrics): void
  sendResponseDelta(requestId, delta): void
  sendResponseDone(requestId, content, usage, finishReason): void
  sendResponseError(requestId, error): void
}
```

- [ ] **Step 2: Implement reconnection with exponential backoff**

- [ ] **Step 3: Commit**

### Task 6.3: LLM Request Executor

**Files:**
- Create: `apps/node-cli/src/executor.ts`

- [ ] **Step 1: Implement executeRequest()**

Receives request payload from platform → resolves provider config (remote API or local Ollama/vLLM) → calls LLM → streams deltas back via WsClient → sends done with usage.

- [ ] **Step 2: Support OpenAI-compatible providers (including Ollama/vLLM)**

- [ ] **Step 3: Support Anthropic provider**

- [ ] **Step 4: Commit**

### Task 6.4: Build and Test CLI

- [ ] **Step 1: Build node-cli**

Run: `npm run build --workspace @xllmapi/node-cli`

- [ ] **Step 2: Integration test — connect node to platform**

Start platform → run node-cli with test token → verify WS connection + auth + capabilities exchange.

- [ ] **Step 3: Commit**

---

## Phase 7: Social Features — Votes, Comments, Favorites

### Task 7.1: Repository + Service — Social Methods

**Files:**
- Modify: `apps/platform-api/src/repositories/platform-repository.ts`
- Modify: `apps/platform-api/src/repositories/postgres-platform-repository.ts`
- Modify: `apps/platform-api/src/services/platform-service.ts`

- [ ] **Step 1: Add vote methods**

`castVote(userId, offeringId, vote)`, `removeVote(userId, offeringId)`, `getVoteSummary(offeringId, userId?)`

- [ ] **Step 2: Add favorite methods**

`addFavorite(userId, offeringId)`, `removeFavorite(userId, offeringId)`, `listFavorites(userId)`

- [ ] **Step 3: Add comment methods**

`addComment(userId, offeringId, content)`, `listComments(offeringId, page)`, `deleteComment(userId, commentId)`

- [ ] **Step 4: Add connection pool methods**

`joinConnectionPool(userId, offeringId)`, `leaveConnectionPool(userId, offeringId)`, `listConnectionPool(userId)`

- [ ] **Step 5: Add market listing method**

`listMarketOfferings(params: { page, limit, filter, sort })` — returns offerings with vote counts, favorite counts, online status.

- [ ] **Step 6: Commit**

### Task 7.2: Social Routes

**Files:**
- Create: `apps/platform-api/src/routes/market.ts`

- [ ] **Step 1: Implement market routes**

```
GET    /v1/market/offerings
GET    /v1/market/offerings/:id
POST   /v1/offerings/:id/vote
DELETE /v1/offerings/:id/vote
POST   /v1/offerings/:id/favorite
DELETE /v1/offerings/:id/favorite
GET    /v1/offerings/:id/comments
POST   /v1/offerings/:id/comments
DELETE /v1/comments/:commentId
POST   /v1/me/connection-pool/:offeringId
DELETE /v1/me/connection-pool/:offeringId
GET    /v1/me/connection-pool
```

- [ ] **Step 2: Implement user profile routes**

```
GET    /v1/users/:handle/profile
GET    /v1/users/:handle/offerings
```

- [ ] **Step 3: Wire market routes in main.ts**

- [ ] **Step 4: Commit**

### Task 7.3: Admin Node Routes

**Files:**
- Modify: `apps/platform-api/src/routes/admin.ts`

- [ ] **Step 1: Add admin node endpoints**

```
GET    /v1/admin/nodes
PUT    /v1/admin/nodes/:id
DELETE /v1/admin/comments/:id
```

- [ ] **Step 2: Commit**

---

## Phase 8: Frontend — Supplier Node Management

### Task 8.1: Node Management Page

**Files:**
- Create: `apps/web/src/pages/app/NodesPage.tsx`

- [ ] **Step 1: Build node management page**

- Token creation/revocation with install guide
- Node list with online/offline status, heartbeat time
- Connected models with three-stage status (pending_verify / verified / published)
- Stats per node (requests, success rate, latency)

- [ ] **Step 2: Add route in App.tsx**

- [ ] **Step 3: Add navigation link in sidebar**

- [ ] **Step 4: Commit**

---

## Phase 9: Frontend — Model Market

### Task 9.1: Market Page

**Files:**
- Create: `apps/web/src/pages/MarketPage.tsx`
- Create: `apps/web/src/pages/MarketDetailPage.tsx`

- [ ] **Step 1: Build market listing page**

Card grid with offering cards showing: model name, supplier avatar, official/distributed badge, online status, vote count, favorites, stability score. Filters and sorting.

- [ ] **Step 2: Build offering detail page**

Info panel, metrics, vote/favorite/join buttons, comment section.

- [ ] **Step 3: Add routes in App.tsx**

- [ ] **Step 4: Commit**

### Task 9.2: User Profile Page

**Files:**
- Create: `apps/web/src/pages/UserProfilePage.tsx`

- [ ] **Step 1: Build user profile page**

Public profile with published offerings list (active + historical), stats.

- [ ] **Step 2: Add route in App.tsx**

- [ ] **Step 3: Commit**

### Task 9.3: Consumer Node Preferences

**Files:**
- Create: `apps/web/src/pages/app/NodePreferencesPage.tsx`

- [ ] **Step 1: Build preferences page**

Global toggle, trust mode selector, managed connection pool list.

- [ ] **Step 2: Add route and navigation**

- [ ] **Step 3: Commit**

---

## Phase 10: End-to-End Testing

### Task 10.1: Full Flow Test

- [ ] **Step 1: Start platform with `./scripts/dev-up.sh`**
- [ ] **Step 2: Create a user and node token via API**
- [ ] **Step 3: Start node-cli connecting to platform**
- [ ] **Step 4: Verify node appears online in dashboard**
- [ ] **Step 5: Publish a model offering from the node**
- [ ] **Step 6: Admin approves the offering**
- [ ] **Step 7: Consumer enables distributed nodes and sends chat request**
- [ ] **Step 8: Verify streaming response flows through node**
- [ ] **Step 9: Verify settlement records are correct (85/15 split)**
- [ ] **Step 10: Test node disconnect → offerings go offline → fallback works**
- [ ] **Step 11: Test social features (vote, comment, favorite)**
- [ ] **Step 12: Commit final state**

---

## Verification Summary

| Test | Expected |
|------|----------|
| Node connects via WS | auth.ok response, node shows online |
| Heartbeat | 30s ping/pong, 10s timeout disconnects |
| Capabilities | Models appear in user's node management page |
| Model verification | Platform sends test request, model status updates |
| Publish offering | Creates offering with execution_mode='node' |
| Chat via node | Streaming response flows consumer→platform→node→LLM→node→platform→consumer |
| Settlement | 85/15 split recorded correctly |
| Node disconnect | Offerings disabled, requests fallback to platform offerings |
| Token revoke | WS disconnected immediately |
| Votes | One vote per user per offering, changes allowed |
| Comments | CRUD works, admin can delete |
| Preferences | Opt-in/out controls routing correctly |

---

## Critical Files Reference

| File | Action | Purpose |
|------|--------|---------|
| `infra/sql/postgres/008_node_network.sql` | Create | DB schema |
| `packages/shared-types/src/index.ts` | Modify | Node types |
| `apps/platform-api/package.json` | Modify | Add `ws` dep |
| `apps/platform-api/src/main.ts` | Modify | WS upgrade handler |
| `apps/platform-api/src/core/node-connection-manager.ts` | Create | WS connection mgmt |
| `apps/platform-api/src/core/provider-executor.ts` | Modify | Add node dispatch branch |
| `apps/platform-api/src/routes/node.ts` | Modify | Node token CRUD + prefs |
| `apps/platform-api/src/routes/market.ts` | Create | Social features API |
| `apps/platform-api/src/services/platform-service.ts` | Modify | Node business logic |
| `apps/platform-api/src/repositories/platform-repository.ts` | Modify | Interface |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | Modify | SQL impl |
| `apps/platform-api/src/repositories/sqlite-platform-repository.ts` | Modify | Stubs |
| `apps/node-cli/` | Create | Entire CLI package |
