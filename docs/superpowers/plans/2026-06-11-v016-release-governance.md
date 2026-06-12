# v0.16 Release Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring v0.16 to a release-ready governance baseline by fixing the real release privacy gate, restoring process asset tracking, updating public docs, and recording release readiness without adding new product features.

**Architecture:** Keep the change split by responsibility: root workflows own real CI/CD gates, `.gitignore` owns repository tracking boundaries, release docs own version state, README files own public onboarding, and verification commands produce the release evidence. No runtime application behavior is changed except documented version metadata.

**Tech Stack:** GitHub Actions, Electron/electron-vite, pnpm-compatible local binaries via `./node_modules/.bin`, Node.js release scan scripts, Markdown project documentation, Git.

---

## File Structure

### Active CI/CD

- Modify `.github/workflows/cd.yml`
  - Add the v0.16 privacy scan gate before `dist:mac` and `dist:win`.
  - Keep tag-triggered release upload behavior.

- Review `.github/workflows/ci.yml`
  - No planned functional change unless the implementation discovers a direct mismatch with v0.16 release checks.

### Inactive / Misleading Workflow

- Delete or neutralize `workbench/.github/workflows/build.yml`
  - Preferred: delete the file because GitHub does not execute workflows from this nested path.
  - Alternative only if deletion is undesirable: replace content with a short Markdown-like YAML comment explaining that root `.github/workflows/cd.yml` is authoritative.

### Repository Governance

- Modify `.gitignore`
  - Stop ignoring formal process assets: `changelog/`, `requirements/`, `产品方向.md`, `原型设计意图.md`, `prototype.html`.
  - Continue ignoring private memory, local env files, databases, build outputs, and ad hoc comparison HTML drafts.

### Release and Version Docs

- Create `changelog/release/v0.16.0.md`
  - Record v0.16 scope, shipped work, verification evidence, remaining release-machine checks, and non-goals.

- Modify `changelog/v0.16/product.md`
  - Set status to release closeout or released depending on actual completion point.
  - Do not rewrite history or change scope beyond方案三.

- Modify `changelog/v0.16/technical.md`
  - Set status to release closeout or released depending on actual completion point.
  - Correct stale “进度：0/16” summary if still present.

- Modify `requirements/req-063-oss-personal-info-decoupling.md`
  - Move status from `confirmed` to `done` only after verification and acceptance are recorded.

- Modify `requirements/README.md`
  - Reflect req-063 completion and keep req-065 confirmed for v0.17.

- Modify `workbench/package.json`
  - Bump `"version"` from `0.15.1` to `0.16.0` when release notes are in place.

### Public Documentation

- Modify `README.md`
  - Replace Tauri-era architecture and commands with Electron-era instructions.
  - Make Chinese content readable directly without relying on a flaky anchor.

- Modify `workbench/README.md`
  - Keep it focused on frontend local development and Vault first-launch configuration.
  - Ensure it does not contradict root README.

### Memory / Status Snapshot

- Modify `记忆/工作台/项目状态快照.md`
  - Update only after implementation and verification, so the next CEO session sees the true v0.16 closeout state.
  - This file is ignored by git; it is still a required local memory update.

---

## Task 1: Fix the Real Release Privacy Gate

**Files:**
- Modify: `.github/workflows/cd.yml`
- Delete or neutralize: `workbench/.github/workflows/build.yml`

- [ ] **Step 1: Inspect current workflows**

Run:

```bash
sed -n '1,180p' .github/workflows/cd.yml
sed -n '1,180p' workbench/.github/workflows/build.yml
```

Expected:

- Root `cd.yml` has tag trigger and `dist:mac` / `dist:win` steps.
- Nested `workbench/.github/workflows/build.yml` contains the v0.16 scan gate but is not an active GitHub workflow.

- [ ] **Step 2: Add build-and-scan gate to root CD**

Edit `.github/workflows/cd.yml` so the steps after Python dependency install and before platform dist become:

```yaml
      - name: Build renderer + main artifacts
        run: pnpm build
        working-directory: workbench

      - name: Verify no personal paths in build artifacts
        run: node scripts/scan-personal-paths.mjs
        working-directory: workbench

      - name: Build (macOS)
        if: matrix.platform == 'mac'
        run: pnpm run dist:mac
        working-directory: workbench
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Build (Windows)
        if: matrix.platform == 'win'
        run: pnpm run dist:win
        working-directory: workbench
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 3: Remove the misleading nested workflow**

Preferred implementation:

```bash
git rm workbench/.github/workflows/build.yml
```

Expected:

- `git status --short` shows `D workbench/.github/workflows/build.yml`.
- Root `.github/workflows/cd.yml` now owns the release scan.

- [ ] **Step 4: Validate workflow text**

Run:

```bash
rg -n "Verify no personal paths|scan-personal-paths|Build renderer" .github/workflows workbench/.github || true
```

Expected:

- Matches appear in `.github/workflows/cd.yml`.
- No active nested workflow remains with a duplicate release implementation.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add .github/workflows/cd.yml workbench/.github/workflows/build.yml
git commit -m "ci(v0.16): enforce privacy scan in release workflow"
```

Expected:

- Commit succeeds.
- Commit only contains workflow changes.

---

## Task 2: Correct Repository Tracking Boundaries

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Inspect ignored formal process assets**

Run:

```bash
git check-ignore -v requirements/req-063-oss-personal-info-decoupling.md changelog/v0.16/product.md 产品方向.md 原型设计意图.md prototype.html || true
sed -n '46,62p' .gitignore
```

Expected before change:

- `.gitignore` reports ignore rules for formal process assets.

- [ ] **Step 2: Replace the local personal section**

Edit `.gitignore` lines under `# ── 本地个人文件（不提交）` to:

```gitignore
# ── 本地个人文件（不提交）─────────────────────────────
agent-roster.local.md
团队章程.local.md
记忆/
CLAUDE.local.md
project-intro.html
prototype-v0.15.html
decision-compare.html
ui-compare.html
v0151-decision-compare.html
workbench/src-tauri/.env
```

Important:

- Do not ignore `requirements/`.
- Do not ignore `changelog/`.
- Do not ignore `产品方向.md`.
- Do not ignore `原型设计意图.md`.
- Do not ignore `prototype.html`.
- Keep `记忆/` ignored.

- [ ] **Step 3: Verify formal assets are no longer ignored**

Run:

```bash
git check-ignore -v requirements/req-063-oss-personal-info-decoupling.md changelog/v0.16/product.md 产品方向.md 原型设计意图.md prototype.html || true
```

Expected:

- No output for those formal assets.

- [ ] **Step 4: Inspect newly visible files carefully**

Run:

```bash
git status --short
```

Expected:

- Many process files may appear as untracked.
- Do not run `git add .`.
- Keep `记忆/`, env files, build output, databases, and local generated artifacts out of staging.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add .gitignore
git commit -m "chore(v0.16): track formal process assets"
```

Expected:

- Commit contains only `.gitignore`.

---

## Task 3: Update Public README Files

**Files:**
- Modify: `README.md`
- Modify: `workbench/README.md`

- [ ] **Step 1: Replace root README with direct bilingual content**

Edit `README.md` to this structure:

```markdown
# Workbench · 工作台

私人 AI 协作桌面应用。四面板界面，支持对话分叉、多 Agent 调度与 Token 成本追踪。

## 中文

### 架构

```text
workbench/        Electron + React + TypeScript
      │ HTTP/WS
      ▼
backend/          Rust · Axum · SQLite
      │ HTTP
      ▼
ai-service/       Python · FastAPI · LLM Router
      │
      ├─ Claude
      ├─ OpenAI
      ├─ DeepSeek
      └─ Gemini
```

### 核心功能

- **四面板布局**：导航 · 分支结构 · 对话 · 详情
- **对话分叉**：在任意节点分叉，在完整分支树中导航
- **多 Agent 调度**：任务状态机、上下文构建器、Agent 沙盒
- **决策收件箱**：Agent 操作的非阻塞人工审批队列
- **多模型支持**：通过统一接口接入 Claude、OpenAI、DeepSeek、Gemini
- **Token 分析**：带 Prompt Cache 可视化的单次/累计成本追踪

### 环境要求

| 服务 | 要求 |
|------|------|
| workbench | Node.js >= 18, pnpm |
| backend | Rust >= 1.75 |
| ai-service | Python >= 3.11 |

### 快速开始

```bash
cd ai-service
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

```bash
cd backend
cargo run
```

```bash
cd workbench
pnpm install
pnpm dev
```

### 首次启动 Vault

首次启动时，应用会自动创建默认 Vault：

```text
~/Workbench-Vault/
├── QA/
└── Projects/
```

Vault 根目录可在 Settings 中重新配置。配置保存在本机 electron-store 中，不进入 GitHub 发布产物。

### 发布前隐私扫描

```bash
cd workbench
pnpm build
node scripts/scan-personal-paths.mjs
```

扫描通过后，构建产物中不应包含 `/Users/`、`/home/`、`C:\Users\` 等个人路径。

## English

Workbench is a personal AI collaboration desktop app with a four-panel interface, conversation branching, multi-agent dispatch, and token cost tracking.

### Stack

- Desktop: Electron + React + TypeScript + electron-vite
- Backend: Rust + Axum + SQLite
- AI service: Python + FastAPI LLM router

### Quick Start

```bash
cd ai-service
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

```bash
cd backend
cargo run
```

```bash
cd workbench
pnpm install
pnpm dev
```

### Release Privacy Check

```bash
cd workbench
pnpm build
node scripts/scan-personal-paths.mjs
```

## License

Apache License 2.0
```

- [ ] **Step 2: Ensure workbench README stays focused**

Inspect `workbench/README.md`.

Expected content:

- Says Electron 33 + React + electron-vite.
- Uses `pnpm install` and `pnpm dev`.
- Keeps First Launch / Vault Configuration section.
- Does not tell users to run Tauri.

If it already satisfies those points, leave it unchanged.

- [ ] **Step 3: Verify no stale Tauri instructions remain in README files**

Run:

```bash
rg -n "Tauri|tauri|npm run tauri|Tauri prerequisites" README.md workbench/README.md
```

Expected:

- No output, unless a line explicitly describes legacy history and is not a setup instruction.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add README.md workbench/README.md
git commit -m "docs(v0.16): update public README for Electron release"
```

Expected:

- Commit contains README changes only.

---

## Task 4: Add v0.16 Release Notes and Version Metadata

**Files:**
- Create: `changelog/release/v0.16.0.md`
- Modify: `workbench/package.json`
- Modify: `changelog/v0.16/product.md`
- Modify: `changelog/v0.16/technical.md`

- [ ] **Step 1: Create release notes**

Create `changelog/release/v0.16.0.md`:

```markdown
---
version: v0.16.0
codename: OSS Decoupling
date: 2026-06-11
status: release-closeout
---

# v0.16.0 · OSS Decoupling

## 概述

v0.16.0 是工作台首次公开发布前的 OSS 治理基线版本。核心目标是解除 v0.15.1 发布阻塞：把 Vault 路径等个人化信息从构建产物中剥离，改为首次启动后在本机运行期配置，并把零个人信息泄露原则固化到发布流程。

## 已交付范围

| 项 | 结论 |
|---|---|
| req-063 OSS 化改造 | 已实现 |
| Vault 配置运行期读取 | 已实现 |
| 默认 `~/Workbench-Vault` 首次启动路径 | 已实现 |
| Settings 内 Vault 配置分区 | 已实现 |
| 构建产物个人路径扫描脚本 | 已实现 |
| 发布前 checklist | 已实现 |
| 发布治理基线 | 本版本收口 |

## 不纳入本版本

- req-065 任务 cwd 选择器
- 新 UI 功能
- Rust 后端测试覆盖扩展
- Agent runtime hooks 完整自动化

## 验证记录

| 命令 | 结果 |
|---|---|
| `cd workbench && ./node_modules/.bin/vitest run` | 待本版本最终验收填写 |
| `cd workbench && ./node_modules/.bin/tsc --noEmit` | 待本版本最终验收填写 |
| `cd workbench && ./node_modules/.bin/electron-vite build` | 待本版本最终验收填写 |
| `cd workbench && node scripts/scan-personal-paths.mjs` | 待本版本最终验收填写 |
| `cd workbench && node scripts/__tests__/scan-personal-paths.test.mjs` | 待本版本最终验收填写 |

## 发布前仍需确认

- 根 `.github/workflows/cd.yml` 已在 dist 前执行隐私扫描。
- `pnpm dist:mac` 后需要对生成 dmg 运行 `scripts/verify-dmg.sh`。
- 首次启动 A/B/C/D 场景需要人工验收记录。

## 已知风险

- `workbench/out` 扫描通过不等于最终 dmg 已验证；最终 tag 前必须运行 dmg 解包扫描。
- 后端 Rust 当前主要依赖编译检查，自动化单元测试仍不足，留待后续版本。

## 关联

- 产品规划：`changelog/v0.16/product.md`
- 技术执行：`changelog/v0.16/technical.md`
- 需求：`requirements/req-063-oss-personal-info-decoupling.md`
```

- [ ] **Step 2: Bump package version**

Edit `workbench/package.json`:

```json
"version": "0.16.0"
```

Expected:

- Only version changes from `0.15.1` to `0.16.0`.

- [ ] **Step 3: Update v0.16 document statuses**

Edit `changelog/v0.16/product.md` frontmatter:

```yaml
status: 发布收口中
```

Edit `changelog/v0.16/technical.md` frontmatter:

```yaml
status: 发布收口中
```

If `technical.md` still says `进度：0/16 节点完成`, replace that line with:

```markdown
> 进度说明：原技术节点已由 req-063 实现分支基本落地；当前阶段转入 v0.16 发布治理收口，详见 `docs/superpowers/specs/2026-06-11-v016-release-governance-design.md`。
```

- [ ] **Step 4: Commit Task 4**

Run:

```bash
git add changelog/release/v0.16.0.md workbench/package.json changelog/v0.16/product.md changelog/v0.16/technical.md
git commit -m "docs(v0.16): add release notes and version metadata"
```

Expected:

- Commit contains release notes, version bump, and status metadata.

---

## Task 5: Update Requirement Status and Project Memory

**Files:**
- Modify: `requirements/req-063-oss-personal-info-decoupling.md`
- Modify: `requirements/README.md`
- Modify: `记忆/工作台/项目状态快照.md` (ignored local memory file)

- [ ] **Step 1: Update req-063 status only after verification**

If Tasks 1-4 are complete and automated verification in Task 6 passes, edit `requirements/req-063-oss-personal-info-decoupling.md` frontmatter:

```yaml
status: done
```

If verification has not passed, leave it as `confirmed` and record the blocker in release notes.

- [ ] **Step 2: Update requirements README**

If req-063 is marked done, edit `requirements/README.md`:

- Move req-063 from confirmed to done.
- Keep req-065 as confirmed with version `v0.17`.
- Update summary counts consistently.

Expected:

- req-063 is not listed as a remaining v0.16 candidate once accepted.
- req-065 remains separate and is not part of v0.16.

- [ ] **Step 3: Update project state snapshot**

Edit `记忆/工作台/项目状态快照.md`:

```yaml
updated: 2026-06-11
updated_by: CEO（v0.16 发布治理收口）
version: v0.16（发布收口中）
```

Update the one-line status to:

```markdown
**v0.16 req-063 主体实现已完成，当前处于发布治理收口：根 CD 隐私扫描、流程资产追踪、README/release 文档和最终验收正在收束。**
```

Add a recent decision:

```markdown
| **2026-06-11** | **董事长选择方案三：v0.16 同时收口发布阻塞和项目治理问题；req-065 保持 v0.17，不进入 v0.16** |
```

Note:

- This memory file is ignored by git, so do not include it in commits unless the project policy changes.

- [ ] **Step 4: Commit tracked requirement changes**

If `requirements/` files are now tracked or intentionally staged:

```bash
git add requirements/req-063-oss-personal-info-decoupling.md requirements/README.md
git commit -m "docs(v0.16): update req-063 release status"
```

Expected:

- Commit does not include `记忆/`.
- If req-063 is not done yet, skip this commit and record why.

---

## Task 6: Run Automated Verification and Update Release Evidence

**Files:**
- Modify: `changelog/release/v0.16.0.md`
- Potentially modify: `workbench/RELEASE.md`

- [ ] **Step 1: Run unit tests**

Run:

```bash
cd workbench && ./node_modules/.bin/vitest run
```

Expected:

- `Test Files  20 passed (20)`
- `Tests  185 passed (185)` or an updated higher count if new tests were added.

- [ ] **Step 2: Run typecheck**

Run:

```bash
cd workbench && ./node_modules/.bin/tsc --noEmit
```

Expected:

- Exit code 0.
- No TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```bash
cd workbench && ./node_modules/.bin/electron-vite build
```

Expected:

- Exit code 0.
- `out/main`, `out/preload`, and `out/renderer` are built.
- Any warning, such as the existing updater eval warning, is recorded in release notes if still present.

- [ ] **Step 4: Run built artifact privacy scan**

Run:

```bash
cd workbench && node scripts/scan-personal-paths.mjs
```

Expected:

- Output includes `OK: no personal paths found`.
- Exit code 0.

- [ ] **Step 5: Run scanner self-test**

Run:

```bash
cd workbench && node scripts/__tests__/scan-personal-paths.test.mjs
```

Expected:

- `17 passed, 0 failed`
- Exit code 0.

- [ ] **Step 6: Update release verification table**

Edit `changelog/release/v0.16.0.md` verification table with actual results, for example:

```markdown
| `cd workbench && ./node_modules/.bin/vitest run` | ✅ 20 files / 185 tests passed |
| `cd workbench && ./node_modules/.bin/tsc --noEmit` | ✅ passed |
| `cd workbench && ./node_modules/.bin/electron-vite build` | ✅ passed; warning: updater uses eval |
| `cd workbench && node scripts/scan-personal-paths.mjs` | ✅ no personal paths found in `workbench/out` |
| `cd workbench && node scripts/__tests__/scan-personal-paths.test.mjs` | ✅ 17 passed, 0 failed |
```

- [ ] **Step 7: Commit Task 6 evidence**

Run:

```bash
git add changelog/release/v0.16.0.md workbench/RELEASE.md
git commit -m "docs(v0.16): record release verification"
```

Expected:

- Commit contains only release evidence docs.

---

## Task 7: Manual Acceptance and Release-Machine Checklist

**Files:**
- Modify: `changelog/release/v0.16.0.md`
- Modify: `workbench/RELEASE.md` if checklist details need adjustment

- [ ] **Step 1: Record first-launch scenario status**

If manual app launch is available, execute:

- Scenario A: existing electron-store vault config
- Scenario B: legacy `.env.local` with `VITE_VAULT_*`
- Scenario C: existing `~/Workbench-Vault`
- Scenario D: fresh install, default vault creation, toast shown once

If not available in current session, add this to `changelog/release/v0.16.0.md`:

```markdown
## 人工验收状态

- 首次启动场景 A/B/C/D：当前 session 未执行，需要发布机人工验收。
- dmg 解包扫描：当前 session 未执行，需要 `pnpm dist:mac` 后运行 `scripts/verify-dmg.sh`。
```

- [ ] **Step 2: Run dmg verification if possible**

Run:

```bash
cd workbench
pnpm run dist:mac
./scripts/verify-dmg.sh release/工作台-0.16.0.dmg
```

Expected:

- `verify-dmg.sh` exits 0.
- If the produced dmg filename differs, use the actual file path under `workbench/release/`.

- [ ] **Step 3: Commit Task 7 acceptance record**

Run:

```bash
git add changelog/release/v0.16.0.md workbench/RELEASE.md
git commit -m "docs(v0.16): record manual release checklist"
```

Expected:

- Commit states whether v0.16 is tag-ready or still needs release-machine checks.

---

## Task 8: Independent Review

**Files:**
- No implementation files by default
- May create review note if project convention requires it

- [ ] **Step 1: Review scope boundaries**

Check:

```bash
git log --oneline --decorate -8
git status --short
git diff --stat origin/feature/req-063-vault-runtime-config..HEAD || true
```

Expected:

- Changes align with v0.16 release governance.
- No req-065 implementation files are present.
- No secrets, `记忆/`, databases, node_modules, or build outputs are staged.

- [ ] **Step 2: Review privacy gate**

Check:

```bash
rg -n "scan-personal-paths|Verify no personal paths|pnpm build|dist:mac|dist:win" .github/workflows/cd.yml
```

Expected:

- `pnpm build` and `scan-personal-paths` appear before dist steps.

- [ ] **Step 3: Review public docs**

Check:

```bash
rg -n "Tauri|tauri|npm run tauri|Tauri prerequisites" README.md workbench/README.md || true
rg -n "req-065|任务 cwd|v0.17" changelog/release/v0.16.0.md changelog/v0.16/product.md requirements/README.md
```

Expected:

- No stale Tauri setup instruction remains.
- req-065 is clearly deferred to v0.17.

- [ ] **Step 4: Review release readiness truthfulness**

Check `changelog/release/v0.16.0.md`.

Expected:

- Commands that were run are marked passed with evidence.
- Commands not run are marked pending, not passed.
- If `verify-dmg.sh` was not run, release note says v0.16 is not tag-ready yet.

- [ ] **Step 5: Commit review notes if needed**

If a review note is created:

```bash
git add <review-note-path>
git commit -m "docs(v0.16): add release governance review"
```

If no note is needed, skip commit and include review results in final handoff.

---

## Task 9: Final Handoff

**Files:**
- Modify: `changelog/release/v0.16.0.md` if final status changes
- Modify: `记忆/工作台/项目状态快照.md` local memory if not already updated

- [ ] **Step 1: Final status check**

Run:

```bash
git status --short --branch
git log --oneline --decorate -10
```

Expected:

- Only intentional untracked local files remain.
- Recent commits show plan, workflow, docs, verification, and status changes.

- [ ] **Step 2: Determine release state**

Use this rule:

```text
If automated verification passed AND root CD scan gate is fixed AND README/release docs updated AND dmg verification/manual first-launch checks are recorded as passed:
  v0.16 is tag-ready.
Else:
  v0.16 is release-closeout complete for code/docs but not tag-ready; list pending checks.
```

- [ ] **Step 3: Final CEO report**

Return:

```text
[CEO] 2026-06-11 v0.16 release governance closeout → <tag-ready / pending release-machine checks> → 通知董事长
```

Include:

- Commit list
- Verification commands and results
- Pending manual checks
- Whether to tag `v0.16.0`
- Files intentionally left untracked

