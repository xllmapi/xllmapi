# 热修复批次 2026-03-30

## 问题 1: 日志多行堆栈没合并 + error.log 级别错误
- 多行 Error 对象被拆成独立行，每行标为 info
- error.log 的内容应默认为 error 级别
- 修复：以有时间戳的行为起始，后续行合并为 detail

## 问题 2: 节点状态页 stopped 节点在异常列表
- enabled=false + breakerState=closed 应该在"停用"分类不是"异常"
- 修复：前端分类逻辑 unhealthy 排除 enabled=false+closed

## 问题 3: 请求详情缺 fallback 信息
- failedAttempts 已写入 response_body 但前端没显示
- 修复：详情面板读 response_body.fallbackAttempts 展示

## 问题 4: 发布不应跳过备份
- XLLMAPI_SKIP_BACKUP=1 应该去掉
- 修复：部署命令不带 SKIP_BACKUP

## 问题 5: last_used_at 缺失列
- node_tokens 表缺少 last_used_at 列，每次心跳报错
- 修复：新增 migration 加列

## 问题 6: 管理员升级日志页面
- 新增页面展示发布历史（版本号、时间、备份状态）
- 从 deploy.sh 的 release log 文件读取
