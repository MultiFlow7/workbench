"""Cache 策略抽象基类。"""

from abc import ABC, abstractmethod

from models.normalized import NormalizedMessage


class BaseCacheStrategy(ABC):
    """Cache 策略抽象基类。

    apply() 返回经过 cache 处理后的 NormalizedMessage 列表（可能注入 cache_control）。
    不修改原始列表（返回新列表）。
    """

    @abstractmethod
    def apply(
        self,
        messages: list[NormalizedMessage],
        caching: bool,
    ) -> list[NormalizedMessage]:
        """处理 messages，按策略注入 cache 控制信息。

        Args:
            messages: 原始 NormalizedMessage 列表。
            caching: 用户是否开启 caching 开关。

        Returns:
            处理后的 NormalizedMessage 列表（新列表，不修改原始数据）。
        """
        ...
