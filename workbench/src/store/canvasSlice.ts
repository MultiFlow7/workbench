/**
 * Canvas Slice · v0.15 节点 4.3 P2
 *
 * 无限画布选中态 + 视图变换的全局状态。
 *
 * 设计要点：
 * - selectedNodeId：单一选中节点的 id；P3/P4 通过订阅它来响应选中变化，
 *   避免 BranchTree → 上层组件的 props drilling。
 * - transform：画布平移/缩放视图矩阵，BranchTree 自身渲染时读取/写入。
 *   保存在 store 是为了让模式切换后回到对话视图时位置不丢失。
 *
 * 与 conversationSlice.selectedAtomId 的关系：
 * - selectedAtomId 表达「当前被选中的对话原子」（驱动 P3 ChatView 路径回放、
 *   写 event_log、计算 currentPath）——这是语义层。
 * - selectedNodeId 表达「画布上被高亮的节点」——这是视觉层。
 * - 节点 4.3 P2 阶段，二者通过 BranchTree 中的 onSelect 同步：用户点击卡片
 *   会同时调用 setSelectedNode(id) 和 selectAtom(id)。后续若需要解耦
 *   （例如多选/框选）再分离。
 */

import { StateCreator } from 'zustand'

export interface CanvasTransform {
  x: number
  y: number
  scale: number
}

export interface CanvasSlice {
  /** 当前画布上被选中的节点 id；null 表示无选中 */
  selectedNodeId: string | null
  /** 画布视图变换（平移 + 缩放） */
  canvasTransform: CanvasTransform

  /** 设置选中节点（传 null 清空选中） */
  setSelectedNode: (id: string | null) => void
  /** 全量替换画布变换 */
  setCanvasTransform: (transform: CanvasTransform) => void
  /** 局部更新画布变换 */
  updateCanvasTransform: (partial: Partial<CanvasTransform>) => void
}

const DEFAULT_TRANSFORM: CanvasTransform = { x: 40, y: 40, scale: 1 }

export const createCanvasSlice: StateCreator<CanvasSlice> = (set) => ({
  selectedNodeId: null,
  canvasTransform: { ...DEFAULT_TRANSFORM },

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  setCanvasTransform: (transform) => set({ canvasTransform: transform }),

  updateCanvasTransform: (partial) =>
    set((state) => ({
      canvasTransform: { ...state.canvasTransform, ...partial },
    })),
})
