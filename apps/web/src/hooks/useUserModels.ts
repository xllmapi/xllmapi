/**
 * useUserModels — 用户模型访问控制总模块
 *
 * 所有需要"用户可用模型列表"的地方统一从这里取。
 * 数据源: /v1/me/connection-pool (用户使用列表 = offering_favorites)
 * Fallback: /v1/network/models (用户没有使用列表时)
 *
 * 提供:
 * - userModels: 用户可用的模型名列表 (去重)
 * - userOfferings: 用户使用列表中的完整 offering 列表
 * - isModelAvailable(model): 检查某个模型是否在用户列表中
 * - loading: 加载状态
 * - refresh(): 重新加载
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface UserOffering {
  offeringId: string;
  logicalModel: string;
  realModel?: string;
  ownerDisplayName?: string;
  ownerHandle?: string;
  executionMode?: string;
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  paused?: boolean;
}

interface PoolResponse {
  data: UserOffering[];
}

interface NetworkModel {
  logicalModel: string;
  providerCount?: number;
  status?: string;
}

interface NetworkModelsResponse {
  data: NetworkModel[];
}

// Module-level cache so all components share the same data
let _cache: { models: string[]; offerings: UserOffering[]; ts: number } | null = null;
let _loading = false;
let _listeners: Set<() => void> = new Set();

function notifyListeners() {
  _listeners.forEach((fn) => fn());
}

async function fetchUserModels(): Promise<{ models: string[]; offerings: UserOffering[] }> {
  const baseUrl = "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem("session_token") || sessionStorage.getItem("session_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    // Try user's usage list first
    const poolRes = await fetch(`${baseUrl}/v1/me/connection-pool`, { headers });
    if (poolRes.ok) {
      const poolData: PoolResponse = await poolRes.json();
      const allOfferings = poolData.data ?? [];
      // Only include non-paused offerings for model list
      const offerings = allOfferings.filter((o) => !o.paused);
      if (allOfferings.length > 0) {
        const seen = new Set<string>();
        const models: string[] = [];
        for (const o of offerings) {
          if (!seen.has(o.logicalModel)) {
            seen.add(o.logicalModel);
            models.push(o.logicalModel);
          }
        }
        return { models, offerings };
      }
    }
  } catch {
    // Fall through to network models
  }

  // Fallback: all network models (for users without usage list)
  try {
    const netRes = await fetch(`${baseUrl}/v1/network/models`, { headers });
    if (netRes.ok) {
      const netData: NetworkModelsResponse = await netRes.json();
      const models = (netData.data ?? []).map((m) => m.logicalModel);
      return { models, offerings: [] };
    }
  } catch {
    // ignore
  }

  return { models: [], offerings: [] };
}

async function loadIfNeeded(force = false) {
  // Use cache if fresh (< 30s)
  if (!force && _cache && Date.now() - _cache.ts < 30_000) return;
  if (_loading) return;

  _loading = true;
  notifyListeners();

  try {
    const result = await fetchUserModels();
    _cache = { ...result, ts: Date.now() };
  } finally {
    _loading = false;
    notifyListeners();
  }
}

export function useUserModels() {
  const [, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const listener = () => {
      if (mounted.current) setTick((t) => t + 1);
    };
    _listeners.add(listener);
    void loadIfNeeded();
    return () => {
      mounted.current = false;
      _listeners.delete(listener);
    };
  }, []);

  const refresh = useCallback(() => {
    void loadIfNeeded(true);
  }, []);

  const isModelAvailable = useCallback((model: string): boolean => {
    if (!_cache) return true; // Still loading, assume available
    if (_cache.models.length === 0) return true; // No list = allow all (fallback)
    return _cache.models.includes(model);
  }, []);

  return {
    userModels: _cache?.models ?? [],
    userOfferings: _cache?.offerings ?? [],
    isModelAvailable,
    loading: _loading,
    hasUserList: (_cache?.offerings.length ?? 0) > 0,
    refresh,
  };
}

// Invalidate cache (call after adding/removing from usage list)
export function invalidateUserModels() {
  _cache = null;
  void loadIfNeeded(true);
}
