"""统一请求/响应 Pydantic 模型，以 Claude content block 格式为基准。"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class TextBlock(BaseModel):
    type: Literal["text"]
    text: str


class ToolUseBlock(BaseModel):
    type: Literal["tool_use"]
    id: str
    name: str
    input: dict


class ToolResultBlock(BaseModel):
    type: Literal["tool_result"]
    tool_use_id: str
    content: str


class ThinkingBlock(BaseModel):
    type: Literal["thinking"]
    thinking: str


ContentBlock = Annotated[
    Union[TextBlock, ToolUseBlock, ToolResultBlock, ThinkingBlock],
    Field(discriminator="type"),
]


class NormalizedMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: list[ContentBlock]


class ChatRequest(BaseModel):
    model: str
    messages: list[NormalizedMessage]
    caching: bool = False
    stream: bool = True
    max_tokens: int = 1024
    tools: list[dict] = []


class UsageStats(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


class ChatResponse(BaseModel):
    role: Literal["assistant"] = "assistant"
    content: list[ContentBlock]
    usage: UsageStats
