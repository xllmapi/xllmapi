# Skeleton Loading UI — 首次访问零布局跳动

**日期**: 2026-04-02
**状态**: 进行中

## 方案
- StatCard/DataTable 增加 loading prop + 骨架占位
- 所有页面去掉 if(loading) return 早期返回
- 页面结构始终渲染，数据区用脉冲动画占位
