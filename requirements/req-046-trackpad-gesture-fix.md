---
id: req-046
title: Mac 触摸板手势修正（双指平移=平移，捏合=缩放）
status: planned
priority: high
source: user-feedback
created: 2026-05-22
version: v0.12
---

# req-046 · Mac 触摸板手势修正

## 背景与目标

当前画布（P2 BranchTree 或画布区域）的触摸板手势与 Mac 交互习惯相反：
- 现状：双指平移 → 触发缩放
- 期望：双指平移 → 平移视图；双指捏合/张开（pinch） → 缩放

Mac 原生交互标准（Safari、Figma、Final Cut 等均如此）：
- `wheel` 事件（双指滑动）→ 平移
- `gesturechange` / `pinch`（双指捏合） → 缩放

## 设计方向

### 事件区分

在画布的 wheel/gesture 事件处理中：

```typescript
onWheel={(e) => {
  if (e.ctrlKey) {
    // ctrlKey=true 表示 pinch 手势（macOS 系统将捏合映射为 ctrlKey+wheel）
    // → 缩放
    handleZoom(e.deltaY)
  } else {
    // 普通双指滑动
    // → 平移
    handlePan(e.deltaX, e.deltaY)
  }
}}
```

macOS 将触摸板的捏合手势映射为 `wheel` 事件并自动附加 `ctrlKey: true`，这是浏览器/Tauri WebView 的标准行为，无需监听原生手势 API。

### 适用范围

- P2 BranchTree（SVG 画布）
- 如未来有其他画布区域（无限画布），同样适用此规则

## 验收指标

| 验收项 | 标准 |
|--------|------|
| 双指上下/左右滑动 | 视图平移，不缩放 |
| 双指捏合/张开 | 视图缩放，不平移 |
| 鼠标滚轮 | 保持原有行为（垂直滚动或缩放，视当前实现决定） |
| 平移边界 | 平移不超出合理范围，不会让内容完全移出视图 |
