// ── WebSocket client ─────────────────────────────────────────────────

import WebSocket from 'ws';
import type {
  NodeMessage,
  NodeAuthOkMessage,
  NodeAuthErrorMessage,
  NodeRequestMessage,
} from '@xllmapi/shared-types';
import { NODE_PROTOCOL_VERSION } from '@xllmapi/shared-types';
import type { NodeConfig } from './config.js';
import { discoverModels } from './discovery.js';
import { executeRequest } from './executor.js';

const MAX_RECONNECT_DELAY_MS = 60_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

export class WsClient {
  private ws: WebSocket | null = null;
  private config: NodeConfig;
  private nodeId: string | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private startTime = Date.now();
  private activeRequests = 0;
  private shuttingDown = false;

  constructor(config: NodeConfig) {
    this.config = config;
  }

  connect(): void {
    if (this.shuttingDown) return;

    console.log(`[ws] Connecting to ${this.config.platformUrl}...`);

    this.ws = new WebSocket(this.config.platformUrl);

    this.ws.on('open', () => {
      console.log('[ws] Connected, authenticating...');
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.send({ type: 'auth', token: this.config.token, protocolVersion: NODE_PROTOCOL_VERSION });
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      this.handleMessage(data);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason.toString() || 'unknown';
      console.log(`[ws] Connection closed (code=${code}, reason=${reasonStr})`);
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error(`[ws] Error: ${err.message}`);
      // 'close' event will fire after this, triggering reconnect
    });
  }

  shutdown(): void {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'shutdown');
      this.ws = null;
    }
  }

  private send(msg: NodeMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(data: WebSocket.RawData): void {
    let msg: NodeMessage;
    try {
      msg = JSON.parse(data.toString()) as NodeMessage;
    } catch {
      console.error('[ws] Failed to parse message');
      return;
    }

    switch (msg.type) {
      case 'auth.ok':
        this.handleAuthOk(msg as NodeAuthOkMessage);
        break;
      case 'auth.error':
        this.handleAuthError(msg as NodeAuthErrorMessage);
        break;
      case 'ping':
        this.handlePing();
        break;
      case 'request':
        this.handleRequest(msg as NodeRequestMessage);
        break;
      default:
        console.log(`[ws] Unhandled message type: ${msg.type}`);
    }
  }

  private async handleAuthOk(msg: NodeAuthOkMessage): Promise<void> {
    this.nodeId = msg.nodeId;
    console.log(`[ws] Authenticated as node ${this.nodeId}`);

    // Discover models and send capabilities
    console.log('[discovery] Discovering models from configured providers...');
    const capabilities = await discoverModels(this.config.providers);
    console.log(`[discovery] Found ${capabilities.length} model(s)`);

    for (const cap of capabilities) {
      console.log(`  - ${cap.realModel} (${cap.providerType})`);
    }

    this.send({ type: 'capabilities', models: capabilities });
    console.log('[ws] Capabilities sent, ready for requests.');
  }

  private handleAuthError(msg: NodeAuthErrorMessage): void {
    console.error(`[ws] Authentication failed: ${msg.message}`);
    console.error('[ws] Check your --token value and try again.');
    this.shuttingDown = true;
    this.ws?.close();
    process.exit(1);
  }

  private handlePing(): void {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const load = this.activeRequests > 0 ? Math.min(this.activeRequests / 4, 1.0) : 0;
    this.send({
      type: 'pong',
      uptime,
      activeRequests: this.activeRequests,
      load,
    });
  }

  private async handleRequest(msg: NodeRequestMessage): Promise<void> {
    const { requestId, payload } = msg;
    console.log(`[req:${requestId}] Executing model=${payload.model}`);

    this.activeRequests++;

    await executeRequest(
      payload,
      this.config.providers,
      // onDelta
      (delta: string) => {
        this.send({ type: 'response.delta', requestId, delta });
      },
      // onDone
      (content, usage, finishReason) => {
        this.activeRequests--;
        console.log(`[req:${requestId}] Completed (${usage.totalTokens} tokens)`);
        this.send({ type: 'response.done', requestId, content, usage, finishReason });
      },
      // onError
      (code, message) => {
        this.activeRequests--;
        console.error(`[req:${requestId}] Error: ${code} — ${message}`);
        this.send({ type: 'response.error', requestId, error: { code, message } });
      },
    );
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown) return;

    console.log(`[ws] Reconnecting in ${this.reconnectDelay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff: 1s, 2s, 4s, 8s, ... max 60s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }
}
