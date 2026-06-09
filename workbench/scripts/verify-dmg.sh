#!/usr/bin/env bash
#
# verify-dmg.sh · dmg 解包扫描验证（v0.16 节点 CI-5，req-063）
#
# 用法：./scripts/verify-dmg.sh release/工作台-x.y.z.dmg
#
# 流程：
#   1. hdiutil attach dmg → 获取挂载点
#   2. 找到 .app bundle
#   3. 对 Contents/Resources/ 跑 scan-personal-paths.mjs
#   4. hdiutil detach
#   5. 透传 scan 退出码（0 = OK，1 = 有泄露）
#
# 平台限制：仅 macOS 可用（依赖 hdiutil）。
# Windows .exe 解包验证由 electron-builder NSIS 输出结构决定，
# 计划在后续版本扩展 verify-exe.ps1（v0.16 不做）。
#
# 退出码：
#   0 = scan OK
#   1 = scan 发现泄露
#   2 = 用户错误（dmg 文件不存在 / 挂载失败）

set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <path-to-dmg>" >&2
  exit 2
fi

DMG_PATH="$1"

if [ ! -f "$DMG_PATH" ]; then
  echo "[verify-dmg] dmg file not found: $DMG_PATH" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCAN_SCRIPT="$SCRIPT_DIR/scan-personal-paths.mjs"

if [ ! -f "$SCAN_SCRIPT" ]; then
  echo "[verify-dmg] scan script not found: $SCAN_SCRIPT" >&2
  exit 2
fi

echo "[verify-dmg] mounting $DMG_PATH"

# 挂载（不弹 Finder 窗口），抓取挂载点路径
MOUNT_OUTPUT=$(hdiutil attach "$DMG_PATH" -nobrowse -noverify)
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | grep '/Volumes/' | tail -1 | awk -F'\t' '{print $NF}')

if [ -z "$MOUNT_POINT" ] || [ ! -d "$MOUNT_POINT" ]; then
  echo "[verify-dmg] mount point not detected" >&2
  echo "$MOUNT_OUTPUT" >&2
  exit 2
fi

echo "[verify-dmg] mounted at $MOUNT_POINT"

# 清理 trap：无论成败都 detach
cleanup() {
  echo "[verify-dmg] unmounting $MOUNT_POINT"
  hdiutil detach "$MOUNT_POINT" -quiet || true
}
trap cleanup EXIT

# 找到 .app bundle（dmg 顶层）
APP_PATH=$(find "$MOUNT_POINT" -maxdepth 2 -name '*.app' -print -quit)

if [ -z "$APP_PATH" ]; then
  echo "[verify-dmg] no .app bundle found in $MOUNT_POINT" >&2
  exit 2
fi

RESOURCES="$APP_PATH/Contents/Resources"

if [ ! -d "$RESOURCES" ]; then
  echo "[verify-dmg] Resources dir not found: $RESOURCES" >&2
  exit 2
fi

echo "[verify-dmg] scanning $RESOURCES"

# 透传 scan 退出码
set +e
node "$SCAN_SCRIPT" "$RESOURCES"
SCAN_EXIT=$?
set -e

echo "[verify-dmg] scan exit code = $SCAN_EXIT"
exit $SCAN_EXIT
