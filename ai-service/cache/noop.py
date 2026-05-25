"""Noop Cache 策略。

OpenAI / DeepSeek / Gemini 的缓存由各自平台自动处理，
服务层无需注入任何 cache_control，直接透传原始 messages。
"""

from cache.base import BaseCacheStrategy
from models.normalized import NormalizedMessage


class NoopCacheStrategy(BaseCacheStrategy):
    """透传策略：不做任何处理，原样返回 messages。"""

    def apply(
        self,
        messages: list[NormalizedMessage],
        caching: bool,
    ) -> list[NormalizedMessage]:
        return list(messages)
