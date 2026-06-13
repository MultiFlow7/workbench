# 工作台 · 发布前 Checklist

每次打 `vX.Y.Z` tag 之前必须勾选完成下列检查项；任一项未过不得 tag。

适用版本：v0.16+（OSS 解耦后）。本文件由 v0.16 节点 CI-4 引入（req-063），后续版本继承条款详见尾部「长期一致性条款」段。

---

## 1. Public Cleanliness 门禁（OSS 化原则）

- [ ] 本地 `cd workbench && pnpm run privacy:scan` 退出码 0
- [ ] 本地 `cd workbench && pnpm run privacy:scan:staged` 退出码 0
- [ ] 本地 `cd workbench && pnpm build && pnpm run privacy:scan:build` 退出码 0
- [ ] CI 中的 "Public cleanliness preflight" step 在最新 commit 上通过
- [ ] 本地 `pnpm dist:mac` 后，按下方「dmg 解压验证」步骤运行 `verify-dmg.sh`，退出码 0
- [ ] 历史重写阶段必须额外运行 `pnpm run privacy:scan:history`，且需要加载受控私有关键词配置后复验。

### dmg 解压验证

```bash
cd workbench
./scripts/verify-dmg.sh release/工作台-0.16.0.dmg
```

脚本内部：mount dmg → 找到 `.app` → 扫描 `Contents/Resources/` → unmount → 透传 scan 退出码。

---

## 2. 功能完整性

- [ ] 全量回归测试 `cd workbench && pnpm test` 通过（含所有 v0.16 新增的 main / renderer 测试用例）
- [ ] 三平台（mac / win / linux）首次启动 4 场景手动验证：
  - 场景 A（store 已有 vaultRoot）：不弹 toast、不创建文件、main console 无报错
  - 场景 B（仅 `.env.local`）：自动迁移到 store，console 含一次性弃用警告
  - 场景 C（`~/Workbench-Vault` 已存在）：引用现有目录、补建 QA/Projects、不弹 toast
  - 场景 D（全新安装）：自动创建 `~/Workbench-Vault/{QA,Projects}` + 弹 toast + 重启后不再弹

  详细验收标准参见 [v0.16 product.md](../changelog/v0.16/product.md#验收标准)。

---

## 3. 配置层（v0.16 OSS 解耦后）

- [ ] `workbench/.env.example` 不含 `VITE_VAULT_*` 三行（已在 v0.16 product.md 「配置文件清理」段约束）
- [ ] `package.json` 的 electron-builder `extraResources` 排除 `!**/.env`（无回归）
- [ ] `workbench/electron/main/vaultBootstrap.ts` 内 `migrateFromEnv` 仍可在 dev 阶段读 `process.env.VITE_VAULT_*`（兼容老开发者本地环境）

---

## 4. 三平台 scanner 一致性验证

scan-public-cleanliness.mjs 仅依赖 Node 18+ 内置模块，跨平台行为一致。CI 在 macOS-latest + windows-latest runner 上都会跑 preflight step，二者同步通过即为一致性证据。Linux 验证由开发者本地通过 Docker 完成：

```bash
docker run --rm -v "$(pwd)/workbench/scripts:/scripts:ro" node:18-alpine \
  node /scripts/__tests__/scan-public-cleanliness.test.mjs
```

预期输出：`19 passed, 0 failed`，退出码 0。

---

## 长期一致性条款（v0.16 起继承）

本文件由 v0.16 req-063 引入。后续版本：

1. **新增打包期内联个人信息**：禁止。任何让 build 产物含用户家目录前缀的代码必须改为运行期 IPC 拉取（vault / settings / sidecar 同款模式）。
2. **修改 public cleanliness allowlist**：必须在 PR 描述中说明引入原因 + CI 截图证据；每条 allowlist 必须有 ruleId、path、reason、owner、reviewedAt 或 expires。
3. **删除 RELEASE.md checklist 项**：禁止。仅可按版本迭代追加新检查项；任何"简化 checklist"提案需经 CEO 审批。

详细背景：参见 v0.16 product.md「长期一致性说明」段。
