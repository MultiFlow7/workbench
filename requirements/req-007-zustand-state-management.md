---
id: req-007
title: Zustand 状态管理层
status: done
priority: high
source: 产品方向.md（架构原则：Panel 只通过选中状态事件通信）
created: 2026-05-17
version: v0.1
---

# req-007 · Zustand 状态管理层

## 需求描述

建立 Zustand store 作为所有 Panel 的通信总线和状态中心。Panel 之间不直接调用彼此，只通过 store 的事件和状态联动。v0.1 需要的 slice 全部在此需求中建立。

## Store 结构

```typescript
// 面板状态 slice
layoutSlice: {
  p2Visible: boolean
  p4Visible: boolean
  currentMode: 'chat' | 'tools' | 'console'
}

// 对话树 slice
conversationSlice: {
  atoms: Record<string, QAAtomMeta>   // 全量节点元数据（from list_qa_atoms）
  selectedAtomId: string | null
  currentPath: QAAtomMeta[]           // 根→selected 路径（派生计算）
  streamingState: 'idle' | 'streaming' | 'cancelled' | 'error'

  // actions
  loadAtoms: () => Promise<void>         // 调用 list_qa_atoms(BASE_PATH)，初始化 atoms
  selectAtom: (id: string) => void       // 更新 selectedAtomId + 重算 currentPath
  appendAtom: (atom: QAAtomMeta) => void // streaming done 后追加新节点
}
```

## QAAtomMeta 类型（对齐无限画布 persistence.ts 格式）

```typescript
interface QAAtomMeta {
  id: string          // "0001-001"，文件名（不含 .md）
  prev: string | null // "[[0001-001]]" Obsidian wikilink；根节点为 null
  children: string[]  // ["[[0001-002]]", "[[0001-01-001]]"]
  summary: string     // question 前 50 字（渲染用）
  timestamp: string
}
```

## 路径计算

`selectAtom(id)` 触发时，从 `atoms` 中沿 `prev` wikilink 向上追溯至根，生成有序数组 `currentPath`。wikilink 解析：从 `"[[0001-001]]"` 提取 id `"0001-001"`。

## 验收标准

- [ ] `useLayoutStore()` hook 可用（面板状态）
- [ ] `useConversationStore()` hook 可用（对话树 + streaming 状态）
- [ ] `loadAtoms()` action 调用 `list_qa_atoms`，正确填充 `atoms` Record
- [ ] `selectAtom()` action 正确计算路径（含多层分叉情况，沿 `prev` wikilink 回溯）
- [ ] `streamingState` 覆盖 `idle / streaming / cancelled / error` 四种状态
- [ ] 所有 Panel 只通过 store 读写状态，无组件间直接 props 传递
- [ ] 使用 immer 的 `produce` 确保不可变更新

## 依赖

req-001（技术栈初始化）、req-008（list_qa_atoms Tauri Command）
