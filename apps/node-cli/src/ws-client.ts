// ── WebSocket client ─────────────────────────────────────────────────

import { createLogger } from '@xllmapi/logger';
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

const log = createLogger({ module: 'ws' });

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
  private totalRequests = 0;
  private shuttingDown = false;
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: NodeConfig) {
    this.config = config;
  }

  connect(): void {
    if (this.shuttingDown) return;

    log.info('connecting', { url: this.config.platformUrl });

    this.ws = new WebSocket(this.config.platformUrl);

    this.ws.on('open', () => {
      log.info('connected, authenticating');
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.send({ type: 'auth', token: this.config.token, protocolVersion: NODE_PROTOCOL_VERSION });
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      this.handleMessage(data);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason.toString() || 'unknown';
      log.warn('connection closed', { code, reason: reasonStr });
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      log.error('websocket error', { error: err.message });
      // 'close' event will fire after this, triggering reconnect
    });
  }

  shutdown(): void {
    this.shuttingDown = true;
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
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
      log.error('failed to parse message');
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
        log.warn('unhandled message type', { type: msg.type });
    }
  }

  private async handleAuthOk(msg: NodeAuthOkMessage): Promise<void> {
    this.nodeId = msg.nodeId;
    log.info('authenticated', { nodeId: this.nodeId });

    // Discover models and send capabilities
    log.info('discovering models from configured providers');
    const capabilities = await discoverModels(this.config.providers);
    log.info('models discovered', { count: capabilities.length });

    for (const cap of capabilities) {
      console.log(`  - ${cap.realModel} (${cap.providerType})`);
    }

    this.send({ type: 'capabilities', models: capabilities });
    log.info('capabilities sent, ready for requests');

    // Start periodic status log
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = setInterval(() => {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const mins = Math.floor(uptime / 60);
      console.log(`[status] 在线 | 请求: ${this.totalRequests} | 运行: ${mins}m | 节点: ${this.nodeId ?? '?'}`);
    }, 60_000);
  }

  private handleAuthError(msg: NodeAuthErrorMessage): void {
    log.error('authentication failed', { message: msg.message });
    log.error('check your --token value and try again');
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
    log.info('executing request', { requestId, model: payload.model });

    this.activeRequests++;
    this.totalRequests++;

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
        log.info('request completed', { requestId, totalTokens: usage.totalTokens });
        this.send({ type: 'response.done', requestId, content, usage, finishReason });
      },
      // onError
      (code, message) => {
        this.activeRequests--;
        log.error('request failed', { requestId, code, message });
        this.send({ type: 'response.error', requestId, error: { code, message } });
      },
    );
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown) return;

    log.info('reconnecting', { delaySeconds: this.reconnectDelay / 1000 });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff: 1s, 2s, 4s, 8s, ... max 60s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }
}
