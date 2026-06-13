"""Anthropic Cache 策略。

caching=true 时，在序列化后的 messages 列表中，最后一个 user message
的最后一个 content block 上注入 cache_control: {type: "ephemeral"}，
触发 Claude Automatic Caching。

apply() 返回 list[NormalizedMessage]（不变），同时返回一个 cache_indices 集合，
指示哪些 message index 需要注入 cache_control。

为保持 apply() 接口返回 list[NormalizedMessage]，采用以下方案：
- 返回一个 _AnnotatedMessageList（list 子类），附带 cache_inject_index 属性
- adapter 的 to_api_messages() 检测传入的 messages 是否为此类型

这样类型层面完全兼容，同时携带 cache 标记信息。
"""

from typing import Optional

from cache.base import BaseCacheStrategy
from models.normalized import NormalizedMessage


class _AnnotatedMessageList(list):
    """携带 cache 标记信息的 list 子类。

    cache_inject_index: 需要注入 cache_control 的 message 下标（-1 = 最后一个）
    """

    def __init__(self, items: list, cache_inject_index: Optional[int] = None):
        super().__init__(items)
        self.cache_inject_index: Optional[int] = cache_inject_index


class AnthropicCacheStrategy(BaseCacheStrategy):
    """Anthropic Automatic Caching 策略。

    caching=true 时，标记最后一条消息需要注入 cache_control。
    """

    def apply(
        self,
        messages: list[NormalizedMessage],
        caching: bool,
    ) -> list[NormalizedMessage]:
        if not caching or not messages:
            return list(messages)

        # 返回 _AnnotatedMessageList，标记最后一条 message（index -1 即 len-1）
        result = _AnnotatedMessageList(
            list(messages),
            cache_inject_index=len(messages) - 1,
        )
        return result  # type: ignore[return-value]


def get_cache_inject_index(messages: list[NormalizedMessage]) -> Optional[int]:
    """从 messages 中提取 cache_inject_index（如有）。"""
    if isinstance(messages, _AnnotatedMessageList):
        return messages.cache_inject_index
    return None
