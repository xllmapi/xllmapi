import type { ChatMessage } from '../api/chat.js';
import type { NodeCapability } from './capabilities.js';

export type NodeMessageType =
  | 'auth' | 'auth.ok' | 'auth.error'
  | 'ping' | 'pong'
  | 'capabilities'
  | 'request'
  | 'response.delta' | 'response.done' | 'response.error';

export interface NodeAuthMessage { type: 'auth'; token: string; protocolVersion: number }
export interface NodeAuthOkMessage { type: 'auth.ok'; nodeId: string }
export interface NodeAuthErrorMessage { type: 'auth.error'; message: string }
export interface NodePingMessage { type: 'ping' }
export interface NodePongMessage { type: 'pong'; uptime: number; activeRequests: number; load: number }
export interface NodeCapabilitiesMessage { type: 'capabilities'; models: NodeCapability[] }
export interface NodeRequestMessage { type: 'request'; requestId: string; payload: { model: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number; stream?: boolean } }
export interface NodeResponseDeltaMessage { type: 'response.delta'; requestId: string; delta: string }
export interface NodeResponseDoneMessage { type: 'response.done'; requestId: string; content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; finishReason: string }
export interface NodeResponseErrorMessage { type: 'response.error'; requestId: string; error: { code: string; message: string } }

export type NodeMessage =
  | NodeAuthMessage | NodeAuthOkMessage | NodeAuthErrorMessage
  | NodePingMessage | NodePongMessage
  | NodeCapabilitiesMessage
  | NodeRequestMessage
  | NodeResponseDeltaMessage | NodeResponseDoneMessage | NodeResponseErrorMessage;
