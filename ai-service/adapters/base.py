"""Adapter 抽象基类。"""

from abc import ABC, abstractmethod
from typing import AsyncGenerator

from models.normalized import ChatRequest, NormalizedMessage


class BaseAdapter(ABC):
    """所有模型 Adapter 的抽象基类。"""

    #: 标识 provider 名称，用于 get_key() 路由
    provider: str = ""

    @abstractmethod
    def to_api_messages(self, messages: list[NormalizedMessage]) -> list[dict]:
        """将 NormalizedMessage 列表转换为各模型原生 API 格式。"""
        ...

    @abstractmethod
    def from_api_response(self, response: dict) -> NormalizedMessage:
        """将各模型原生响应转换为 NormalizedMessage。"""
        ...

    @abstractmethod
    async def stream(
        self,
        messages: list[NormalizedMessage],
        request: ChatRequest,
        api_key: str,
    ) -> AsyncGenerator[str, None]:
        """流式调用，yield SSE 行（已包含 'data: ' 前缀和尾部 '\n\n'）。"""
        ...

    @abstractmethod
    async def complete(
        self,
        messages: list[NormalizedMessage],
        request: ChatRequest,
        api_key: str,
    ) -> dict:
        """非流式调用，返回包含 role/content/usage 的 dict。"""
        ...
