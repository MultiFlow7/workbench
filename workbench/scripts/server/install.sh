#!/usr/bin/env bash
set -euo pipefail

# 严格校验 Node.js 22.x
NODE_MAJOR=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" != "22" ]; then
  echo "ERROR: Node.js 22.x required (found $(node --version))" >&2
  exit 1
fi

VERSION="${1:-latest}"
INSTALL_DIR="/opt/workbench-server"
DATA_DIR="/var/lib/workbench-agent"
SERVICE_NAME="workbench-agent"

echo "Installing workbench-server ${VERSION} to ${INSTALL_DIR}..."

# 下载并解压（从 GitHub Release）
TARBALL_URL="https://github.com/MultiFlow7/workbench/releases/download/v${VERSION}/server-v${VERSION}.tar.gz"
TMP_DIR=$(mktemp -d)
curl -fsSL "${TARBALL_URL}" -o "${TMP_DIR}/server.tar.gz"
mkdir -p "${INSTALL_DIR}"
tar -xzf "${TMP_DIR}/server.tar.gz" -C "${INSTALL_DIR}" --strip-components=1
rm -rf "${TMP_DIR}"

# 安装 production 依赖
cd "${INSTALL_DIR}" && npm ci --production --omit=dev

# 确保数据目录存在
mkdir -p "${DATA_DIR}"
chown -R "${SUDO_USER:-root}:${SUDO_USER:-root}" "${DATA_DIR}" 2>/dev/null || true

# 生成 systemd unit
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Workbench Agent Server
After=network.target

[Service]
Type=simple
User=${SUDO_USER:-root}
WorkingDirectory=${DATA_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/dist/index.js
Environment=NODE_ENV=production
Environment=WORKBENCH_DATA_DIR=${DATA_DIR}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "Done. Check: systemctl status ${SERVICE_NAME}"
