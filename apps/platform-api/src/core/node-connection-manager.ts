import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { NodeMessage, NodeCapability } from '@xllmapi/shared-types';
import { NODE_HEARTBEAT_INTERVAL_MS, NODE_HEARTBEAT_TIMEOUT_MS, NODE_REQUEST_TIMEOUT_MS } from '@xllmapi/shared-types';
import { createLogger } from '../lib/logger.js';
import { platformRepository } from '../repositories/index.js';

interface NodeConnection {
  ws: WebSocket;
  userId: string;
  tokenId: string;
  lastPong: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeout: NodeJS.Timeout;
  nodeId: string;
  onSseWrite?: (chunk: string) => void;
}

class NodeConnectionManager {
  private wss: WebSocketServer;
  private connections: Map<string, NodeConnection> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private logger = createLogger();

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.startHeartbeat();
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.handleConnection(ws, req);
    });
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    let authenticated = false;
    let nodeId: string | null = null;

    // 10s auth timeout
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        this.logger.warn('node-ws: auth timeout, closing connection');
        ws.close(4001, 'Authentication timeout');
      }
    }, 10_000);

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as NodeMessage;

        if (!authenticated) {
          // Expect auth message first
          if (msg.type !== 'auth') {
            ws.send(JSON.stringify({ type: 'auth.error', message: 'Expected auth message' }));
            ws.close(4002, 'Expected auth message');
            clearTimeout(authTimeout);
            return;
          }

          const authResult = await platformRepository.authenticateNodeToken(msg.token);
          if (!authResult) {
            ws.send(JSON.stringify({ type: 'auth.error', message: 'Invalid or revoked token' }));
            ws.close(4003, 'Invalid token');
            clearTimeout(authTimeout);
            return;
          }

          clearTimeout(authTimeout);
          authenticated = true;
          nodeId = authResult.nodeTokenId;

          // Store connection
          this.connections.set(nodeId, {
            ws,
            userId: authResult.userId,
            tokenId: authResult.tokenId,
            lastPong: Date.now(),
          });

          // Send auth.ok
          ws.send(JSON.stringify({ type: 'auth.ok', nodeId }));

          // Extract IP from request
          const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
            ?? req.socket.remoteAddress
            ?? undefined;

          // Register/update node in DB
          await platformRepository.upsertNode({
            nodeId,
            userId: authResult.userId,
            tokenId: authResult.tokenId,
            ipAddress,
            userAgent: req.headers['user-agent'] ?? undefined,
          });

          await platformRepository.updateNodeStatus({ nodeId, status: 'online' });

          this.logger.info('node-ws: node authenticated', { nodeId, userId: authResult.userId });
          return;
        }

        // Already authenticated — handle subsequent messages
        if (nodeId) {
          this.handleMessage(nodeId, msg);
        }
      } catch (err) {
        this.logger.error('node-ws: message parse error', { error: String(err) });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (nodeId) {
        this.logger.info('node-ws: node disconnected', { nodeId });
        this.cleanupNode(nodeId);
      }
    });

    ws.on('error', (err) => {
      this.logger.error('node-ws: websocket error', { nodeId, error: String(err) });
      if (nodeId) {
        this.cleanupNode(nodeId);
      }
    });
  }

  private async handleMessage(nodeId: string, msg: NodeMessage): Promise<void> {
    switch (msg.type) {
      case 'pong': {
        const conn = this.connections.get(nodeId);
        if (conn) {
          conn.lastPong = Date.now();
        }
        // Optionally store metrics from pong (uptime, load, activeRequests)
        this.logger.info('node-ws: pong received', { nodeId, uptime: msg.uptime, load: msg.load });
        await platformRepository.updateNodeStatus({
          nodeId,
          status: 'online',
          lastHeartbeatAt: new Date().toISOString(),
        });
        break;
      }

      case 'capabilities': {
        this.logger.info('node-ws: capabilities received', { nodeId, modelCount: msg.models.length });
        await platformRepository.updateNodeCapabilities({ nodeId, capabilities: msg.models });
        break;
      }

      case 'response.delta': {
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending?.onSseWrite) {
          const sseChunk = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: msg.delta }, finish_reason: null }] })}\n\n`;
          pending.onSseWrite(sseChunk);
        }
        break;
      }

      case 'response.done': {
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.requestId);
          pending.resolve({
            content: msg.content,
            usage: msg.usage,
            finishReason: msg.finishReason,
          });
        }
        break;
      }

      case 'response.error': {
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.requestId);
          pending.reject(new Error(`Node error [${msg.error.code}]: ${msg.error.message}`));
        }
        break;
      }

      default:
        this.logger.warn('node-ws: unknown message type', { nodeId, type: (msg as any).type });
    }
  }

  dispatch(
    nodeId: string,
    requestId: string,
    payload: object,
    onSseWrite?: (chunk: string) => void,
  ): Promise<any> {
    const conn = this.connections.get(nodeId);
    if (!conn) {
      return Promise.reject(new Error(`Node ${nodeId} is not connected`));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out after ${NODE_REQUEST_TIMEOUT_MS}ms`));
      }, NODE_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
        nodeId,
        onSseWrite,
      });

      conn.ws.send(JSON.stringify({ type: 'request', requestId, payload }));
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const staleThreshold = NODE_HEARTBEAT_INTERVAL_MS + NODE_HEARTBEAT_TIMEOUT_MS;

      for (const [nodeId, conn] of this.connections) {
        // Check for stale connections first
        if (now - conn.lastPong > staleThreshold) {
          this.logger.warn('node-ws: heartbeat timeout, disconnecting node', { nodeId });
          this.disconnectNode(nodeId);
          continue;
        }

        // Send ping
        try {
          conn.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          this.logger.error('node-ws: failed to send ping', { nodeId });
          this.disconnectNode(nodeId);
        }
      }
    }, NODE_HEARTBEAT_INTERVAL_MS);
  }

  disconnectNode(nodeId: string): void {
    const conn = this.connections.get(nodeId);
    if (conn) {
      try {
        conn.ws.close(1000, 'Disconnected by server');
      } catch {
        // WS may already be closed
      }
    }
    this.cleanupNode(nodeId);
  }

  private cleanupNode(nodeId: string): void {
    this.connections.delete(nodeId);

    // Update DB status (methods may return void or Promise<void>)
    try {
      const statusResult = platformRepository.updateNodeStatus({ nodeId, status: 'offline' });
      if (statusResult && typeof (statusResult as any).catch === 'function') {
        (statusResult as Promise<void>).catch(() => {});
      }
      const availResult = platformRepository.setNodeOfferingsAvailability({ nodeId, available: false });
      if (availResult && typeof (availResult as any).catch === 'function') {
        (availResult as Promise<void>).catch(() => {});
      }
    } catch {
      // Ignore cleanup errors
    }

    // Reject all pending requests for this node
    for (const [reqId, pending] of this.pendingRequests) {
      if (pending.nodeId === nodeId) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(reqId);
        pending.reject(new Error(`Node ${nodeId} disconnected`));
      }
    }

    this.logger.info('node-ws: node cleaned up', { nodeId });
  }

  async testModel(nodeId: string, model: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.dispatch(nodeId, `test_${Date.now()}`, {
        model,
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0,
        maxTokens: 10,
        stream: false,
      });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err?.message ?? 'Unknown error' };
    }
  }

  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const [nodeId] of this.connections) {
      this.disconnectNode(nodeId);
    }
    this.wss.close();
  }

  isNodeOnline(nodeId: string): boolean {
    return this.connections.has(nodeId);
  }

  getOnlineNodeIds(): string[] {
    return Array.from(this.connections.keys());
  }
}

export const nodeConnectionManager = new NodeConnectionManager();
