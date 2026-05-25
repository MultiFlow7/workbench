# Changelog

All notable changes to this project will be documented in this file.

---

## [0.13] - 2026-05-23
### Added
- Python AI service (`ai-service/`) — independent LLM routing layer
- Multi-model adapter support: Claude, OpenAI, DeepSeek, Gemini
- LLM Gateway with API key management and token cost tracking
- Prompt caching support for Claude (Anthropic cache_control)
- Unified `/v1/chat` endpoint with streaming (SSE)

## [0.12] - 2026-05
### Added
- Prompt caching UI — cache hit/miss indicators in token analytics
- Tool call UI feedback — inline display of tool invocations and results

## [0.10 – 0.11] - 2026-05
### Added
- Built-in tool set (file read, shell exec, web search stub)
- Tool calling framework with structured tool-use loop

## [0.8 – 0.9] - 2026-04
### Added
- Agent sandbox — isolated execution environment per agent task
- Harness layer — permission control and hook system for agent actions
- Markdown rendering in ChatView (GFM, syntax highlighting)

## [0.6 – 0.7] - 2026-04
### Added
- Decision inbox — non-blocking human approval queue
- Pipeline trigger rules — event-based agent dispatch
- Agent registry UI — view and manage registered agents
- Task trigger UI — manually fire agent tasks

## [0.3 – 0.5] - 2026-03
### Added
- Token cost dashboard — per-session and cumulative cost tracking
- Context window indicator
- Token analytics panel with time-series chart
- Multi-level branch visualization

## [0.1 – 0.2] - 2026-03
### Added
- Tauri v2 desktop application scaffold
- Four-panel layout (Nav · Structure · Main · Detail)
- Conversation branch tree (P2) + linear chat view (P3)
- Zustand state management (conversation, layout, settings, decisions, notifications)
- Three navigation modes: Conversation · Tool Management · Console
- WebSocket AI client
- Rust backend (Axum + SQLite) — agent task state machine, context builder, dispatcher
