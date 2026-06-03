"""Provider 抽象基类与请求模型。

Provider 层的合约：
- 入参统一为 Anthropic Messages API 格式（`AnthropicRequest`）
- 出参统一为 Anthropic SSE event dict 序列（异步迭代器）

对外的 event dict 形状必须能直接序列化进 `data: {...}\n\n` 流，
以保证下游 SSE 路由对所有 provider 都是同一份消费逻辑。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Optional

from pydantic import BaseModel, Field


class AnthropicRequest(BaseModel):
    """Anthropic Messages API 入参的最小子集。

    与官方一致：messages / system / tools 都是 list[dict]，
    避免在此处提前强约束（各 provider 自行做转换）。
    """

    model: str
    messages: list[dict[str, Any]]
    system: Optional[str] = None
    tools: Optional[list[dict[str, Any]]] = None
    stream: bool = True
    max_tokens: int = Field(default=8096, ge=1)
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    # 透传给 provider 的额外字段（不展开为强类型，便于演进）
    metadata: Optional[dict[str, Any]] = None


class BaseProvider(ABC):
    """所有 LLM provider 的抽象基类。

    子类只需实现 `stream_completion`，输出符合 Anthropic SSE 协议的事件 dict。
    """

    #: provider 名称，用于日志/路由
    name: str = ""

    @abstractmethod
    async def stream_completion(
        self, req: AnthropicRequest, api_key: Optional[str] = None
    ) -> AsyncIterator[dict[str, Any]]:
        """以 Anthropic SSE event 格式输出流。

        必须按顺序产出（缺失中间事件可能导致下游解析失败）：
            message_start → content_block_start → content_block_delta* →
            content_block_stop → message_delta → message_stop
        """
        ...
