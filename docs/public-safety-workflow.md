# GitHub 公开边界工作流

本仓库默认按「使用中开发」来设计：本地可以存在真实工作资料、迁移脚本和个人路径，但进入 GitHub 的内容必须经过公开边界。

本流程归 CEO / 版本规划层负责推进，不是工程 Agent 的临时自查项。每次需求进入版本、PR 准备合并、tag / GitHub Release 准备发布时，都要按本文件确认 publication boundary 是否清洁。

## 三个区域

- `public repo`：产品代码、需求、changelog、可公开文档。只有这里的内容可以进入 GitHub。
- `local runtime`：本地迁移脚本、个人导入工具、临时 UI 对比文件、私有配置。默认通过 `.gitignore` 隔离。
- `user data`：真实对话、知识库、Obsidian vault、API key、运行日志。应保留在仓库外，或只通过导出后的脱敏样例进入仓库。

## 默认提交流程

1. 正常开发和使用，不需要先清空本地资料。
2. 只 stage 本次要公开的文件。
3. `pre-commit` hook 自动运行 staged 隐私扫描。
4. 扫描通过后再 commit；如果扫描失败，先脱敏或把文件移回本地区域。

当前 hook 执行：

```bash
pnpm --dir workbench privacy:scan:staged
```

发布前建议再执行：

```bash
pnpm --dir workbench privacy:scan
pnpm --dir workbench privacy:scan:history
```

## 长期产品化方向

这个问题不应该长期靠人肉检查。更合理的方向是把工作台拆成两个边界：

- `workspace boundary`：真实使用空间，允许本地路径、真实资料、迁移缓存存在。
- `publication boundary`：准备同步 GitHub / 发版 / 交给外部协作者的公开空间，必须通过扫描、脱敏、样例化和 allowlist 审核。

后续可以把它沉淀成一个通用能力：任何导入、本地运行、对话迁移都先落在 workspace boundary；只有用户主动选择「发布/同步/导出」时，才生成 publication candidate，并由扫描器给出可解释的阻断项。
