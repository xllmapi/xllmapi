# Fix: 模型组单节点停止导致整组断开连接

## 问题

供应商停止模型组中一个节点时，用户看到整个模型组被断开连接。

## 根因

`listConnectionPoolGrouped` 使用 `bool_and` 聚合：
- `bool_and(o.enabled)` — 一个 false 则整组 false
- `bool_and(f.paused)` — 一个 true 则整组 true（但这里用的是 AND 所以需要全部 true 才 true）

实际上前端判断 `!m.paused && m.enabled`，当组内一个 offering enabled=false 时整组显示为不活跃。

## 修复

将 `bool_and(o.enabled)` 改为 `bool_or(o.enabled)`：只要组内有一个 offering 还在运行，组就是活跃的。

`bool_and(f.paused)` 改为 `NOT bool_or(NOT f.paused)` 或直接改为检查是否存在至少一个未 paused 的 favorite：`bool_or(NOT f.paused) AS "hasActive"`，前端判断改为 `m.hasActive && m.enabled`。

更简洁的方案：后端直接计算 `COUNT(*) FILTER (WHERE o.enabled AND NOT f.paused)` 作为 activeCount，前端用 activeCount > 0 判断。
