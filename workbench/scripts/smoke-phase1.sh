#!/usr/bin/env bash
# v0.15 节点 1.8 · Phase 1 端到端 smoke test
#
# 验证项（不需要图形化界面，可在 CI / headless 环境跑）：
#   T1.1  electron-vite build 产物完整（main/preload/renderer 三段）
#   T1.2  IPC 通道契约（preload 暴露的 window.api.* 类型签名编译通过）
#   T1.3  Python sidecar 健康（spawn uvicorn + curl /health 返回 200）
#   T1.6  v0.14 atom 解析（用 fsGuard 单元测试覆盖路径越界保护）
#   单元  fsGuard + conversationSlice 全部通过
#
# 不在本脚本范围（依赖 Phase 2 才能跑）：
#   T1.4  asar unpack 路径解析（需 electron-builder 实际打包）
#   T1.5  dialog 工作目录选择（需 GUI 交互）
#   T2.x  发起 AI 对话（需 Phase 2 SDK 接入）

set -euo pipefail

WORKBENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$WORKBENCH_DIR/.." && pwd)"
AI_SERVICE_DIR="$ROOT_DIR/ai-service"

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "  ✓ $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "  ✗ $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

echo "── Phase 1 smoke test ──"
echo "Workbench:  $WORKBENCH_DIR"
echo "AI service: $AI_SERVICE_DIR"
echo ""

cd "$WORKBENCH_DIR"

# ── 1. tsc --noEmit ─────────────────────────────────────────────────────────
echo "1) TypeScript 编译"
if pnpm exec tsc --noEmit 2>&1 | grep -q "error"; then
  fail "tsc 报错"
else
  pass "tsc --noEmit 零错误"
fi

# ── 2. electron-vite build ──────────────────────────────────────────────────
echo "2) electron-vite build"
if pnpm exec electron-vite build > /tmp/smoke-build.log 2>&1; then
  pass "main + preload + renderer 三段全部构建"
  ls out/main/index.js out/preload/index.mjs out/renderer/index.html > /dev/null 2>&1 \
    && pass "产物路径存在" \
    || fail "产物路径缺失"
else
  fail "electron-vite build 失败（见 /tmp/smoke-build.log）"
fi

# ── 3. 单元测试 ─────────────────────────────────────────────────────────────
echo "3) 单元测试"
if pnpm exec vitest run > /tmp/smoke-vitest.log 2>&1; then
  TESTS=$(grep -oE '[0-9]+ passed' /tmp/smoke-vitest.log | head -1)
  pass "vitest 通过 ($TESTS)"
else
  fail "vitest 失败（见 /tmp/smoke-vitest.log）"
fi

# ── 4. Python ai-service 健康探测 ───────────────────────────────────────────
echo "4) Python ai-service spawn + /health"
if [ ! -d "$AI_SERVICE_DIR" ]; then
  fail "ai-service 目录不存在"
else
  cd "$AI_SERVICE_DIR"
  python3 -m uvicorn main:app --host 127.0.0.1 --port 8765 --log-level warning \
    > /tmp/smoke-aisvc.log 2>&1 &
  AISVC_PID=$!
  cd "$WORKBENCH_DIR"

  # 轮询 health 最多 6 秒
  HEALTHY=0
  for i in $(seq 1 24); do
    if curl --noproxy '*' -sf -o /dev/null -m 1 http://127.0.0.1:8765/health; then
      HEALTHY=1
      break
    fi
    sleep 0.25
  done

  if [ $HEALTHY -eq 1 ]; then
    pass "ai-service /health 返回 200（启动 ${i}×250ms）"
  else
    fail "ai-service /health 未在 6s 内就绪"
  fi

  kill -TERM "$AISVC_PID" 2>/dev/null || true
  sleep 1
  kill -KILL "$AISVC_PID" 2>/dev/null || true
fi

# ── 汇总 ──────────────────────────────────────────────────────────────────
echo ""
echo "── 汇总 ──"
echo "  通过: $PASS_COUNT"
echo "  失败: $FAIL_COUNT"
if [ $FAIL_COUNT -gt 0 ]; then
  exit 1
fi
