# v0.16 Release Governance Design

Date: 2026-06-11
Owner: workbench-ceo
Project: 工作台
Status: draft-for-chair-review

## Decision

The chairman selected option 3: v0.16 will close both the release blockers and the project governance gaps discovered during the req-063 OSS decoupling work.

This changes the v0.16 closeout target from a narrow privacy fix into the first public release baseline:

```text
v0.16 = OSS Decoupling + first-release governance baseline
```

The release must still stay focused. v0.16 does not add user-facing feature scope beyond req-063. It does not include req-065, the task cwd selector.

## Current Stage

The project is in v0.16 release closeout.

Known facts:

- Current branch: `feature/req-063-vault-runtime-config`
- `workbench/package.json` still reports `0.15.1`
- v0.16 req-063 implementation is mostly complete
- No `changelog/release/v0.16.0.md` exists yet
- Local verification has passed for:
  - `vitest run`: 20 files, 185 tests
  - `tsc --noEmit`
  - `node scripts/scan-personal-paths.mjs`
  - `node scripts/__tests__/scan-personal-paths.test.mjs`: 17 passed
- The root release workflow still lacks the privacy scan gate
- Several process assets are currently ignored by `.gitignore`

## Goals

1. Make v0.16 safe to publish under the OSS zero personal information principle.
2. Make the release process enforce that principle in the real tag-triggered workflow.
3. Bring project process assets into a coherent tracked/untracked boundary.
4. Update public documentation so a new user sees the Electron-era project, not stale Tauri instructions.
5. Leave a clear release record and next-step boundary for v0.16.1 or v0.17.

## Non-Goals

The following are explicitly out of scope for v0.16:

- req-065 task cwd selector
- New UI features
- Backend Rust test coverage expansion
- Full Agent runtime hook automation
- Large historical changelog rewrite
- Full removal of legacy Tauri directories or scripts
- New external services or dependency changes

## Workstreams

### A. Release Gate Correction

Problem:

The workflow containing the privacy scan lives at `workbench/.github/workflows/build.yml`, but GitHub Actions only loads workflows from the repository root `.github/workflows`. The real tag release workflow is `.github/workflows/cd.yml`, and it currently builds and uploads release assets without running the v0.16 privacy scan.

Design:

- Move or duplicate the v0.16 build-and-scan gate into root `.github/workflows/cd.yml`.
- Keep the sequence cheap-first:
  1. install dependencies
  2. `pnpm build`
  3. `node scripts/scan-personal-paths.mjs`
  4. `pnpm run dist:mac` or `pnpm run dist:win`
  5. upload release assets
- Remove, relocate, or clearly neutralize `workbench/.github/workflows/build.yml` so it cannot be mistaken for an active GitHub workflow.
- Keep `workbench/RELEASE.md` as the human release checklist.

Success criteria:

- Root CD workflow contains a personal-path scan before every dist step.
- The obsolete subdirectory workflow no longer creates false confidence.

### B. Process Asset Governance

Problem:

`.gitignore` currently ignores `requirements/`, `changelog/`, `产品方向.md`, `原型设计意图.md`, and `prototype.html`. This conflicts with project rules that define requirements and changelogs as formal workflow assets.

Design:

- Stop ignoring formal process assets:
  - `requirements/`
  - `changelog/`
  - `产品方向.md`
  - `原型设计意图.md`
  - `prototype.html`
- Continue ignoring private and generated assets:
  - `记忆/`
  - local `.env*`
  - build outputs
  - databases
  - node modules
  - ad hoc comparison HTML drafts
  - local team/private notes not meant for public release
- After the ignore rule change, explicitly inspect `git status` before staging anything. Do not blindly add all newly visible files.
- Track only the v0.16-relevant process assets needed for the release and governance baseline.

Success criteria:

- The repository can track requirements and changelog files intentionally.
- Private memory and local secrets remain ignored.
- The v0.16 PR can be reviewed without a flood of unrelated local artifacts.

### C. Release Documentation

Problem:

The project has no v0.16 release note. Several docs still describe the old Tauri-era startup path or old project phase.

Design:

- Add `changelog/release/v0.16.0.md`.
- Update v0.16 product and technical document status to reflect release closeout rather than planning, without rewriting their history.
- Update the project status snapshot so the next CEO session sees the current state.
- Update `requirements/README.md` and `req-063` status if release acceptance completes.
- Keep req-065 as confirmed for v0.17; do not merge it into v0.16.

Success criteria:

- A reader can determine that v0.16 is in release closeout or released, not still a candidate.
- Release notes list delivered scope, verification, known residual risks, and non-goals.

### D. Public README Alignment

Problem:

The root README still describes Tauri and `npm run tauri dev`, while the current app is Electron + electron-vite + pnpm.

Design:

- Update the root README to Electron-era architecture.
- Make the Chinese README content readable directly, without relying on the `[中文]` anchor.
- Keep root README high-level.
- Keep `workbench/README.md` focused on local frontend development and first-launch Vault configuration.
- Mention privacy scan expectations for release builds.

Success criteria:

- New users see correct install and dev commands.
- Chinese content is available as readable Markdown, not hidden behind a flaky anchor.

### E. Verification and Acceptance

Problem:

Automated local verification is strong, but release acceptance still lacks a complete record for the governance-expanded scope.

Design:

Run and record:

- `cd workbench && ./node_modules/.bin/vitest run`
- `cd workbench && ./node_modules/.bin/tsc --noEmit`
- `cd workbench && ./node_modules/.bin/electron-vite build`
- `cd workbench && node scripts/scan-personal-paths.mjs`
- `cd workbench && node scripts/__tests__/scan-personal-paths.test.mjs`

Manual or release-machine checks:

- First-launch scenario A: existing store config
- First-launch scenario B: legacy `.env.local` migration
- First-launch scenario C: existing `~/Workbench-Vault`
- First-launch scenario D: fresh install creates default vault and shows toast once
- `pnpm dist:mac` followed by `scripts/verify-dmg.sh` on the produced dmg

Success criteria:

- Release notes and `workbench/RELEASE.md` show which checks passed and which require a release machine.
- No success claim is made for checks that were not run.

## Agent Responsibilities

Codex currently runs as `workbench-ceo`. If true sub-agent tools are available and the task boundary justifies it, dispatch should follow the Codex adapter. If not, the CEO may execute directly while preserving the same gates.

Suggested responsibilities:

- `workbench-product`: release notes, requirement status, changelog state, README language consistency.
- `tauri-platform`: root CD workflow, packaging checklist, dmg verification scripts. Despite the legacy name, this role owns the desktop platform layer.
- `review-agent`: independent review of scope, privacy gate, `.gitignore` boundary, and release readiness.
- `qa-agent`: acceptance checklist execution and report.
- `workbench-memory`: update project status snapshot after decisions and completion.

## Implementation Order

1. Update this design if the chairman requests changes.
2. Create an implementation plan from this design.
3. Fix root release workflow and subdirectory workflow ambiguity.
4. Adjust `.gitignore` governance boundary.
5. Update release and public docs.
6. Run automated verification.
7. Complete manual/release-machine checklist or record what remains unrun.
8. Run independent review.
9. Update project memory/status snapshot.
10. Prepare release handoff.

## Risks

### Scope Expansion

Risk: Governance work can expand into a full repository cleanup.

Mitigation: Only touch governance items that directly affect v0.16 release safety, public onboarding, or process asset traceability.

### Sensitive Document Exposure

Risk: Unignoring process directories may expose personal or private notes.

Mitigation: Inspect file lists before staging. Keep `记忆/`, `.env*`, local drafts, databases, and generated output ignored. If a process document contains private information, either redact it or keep it out of this PR and document the reason.

### Workflow Drift

Risk: Root and subdirectory workflows may diverge again.

Mitigation: Keep only root workflows as active. If a subdirectory workflow is retained for reference, mark it clearly as inactive or move its useful content into root workflows.

### False Release Confidence

Risk: Passing `workbench/out` scan does not prove final dmg contents are clean.

Mitigation: Require `verify-dmg.sh` before tag release. If this cannot be run in the current session, the release handoff must state that v0.16 is not tag-ready yet.

## Approval Gate

This design requires chairman approval before implementation planning begins.

Approval means:

- v0.16 scope is expanded to include release governance.
- req-065 remains out of v0.16.
- The CEO may create an implementation plan and then execute within the boundaries above.
