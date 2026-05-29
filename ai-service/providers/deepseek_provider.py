"""DeepSeek provider：OpenAI 兼容模式。

直接继承 OpenAIProvider 复用全部转换逻辑，只覆盖 base_url 与 env key 名。
"""

from __future__ import annotations

import os

from providers.openai_provider import OpenAIProvider

DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


class DeepSeekProvider(OpenAIProvider):
    name = "deepseek"
    base_url = DEEPSEEK_BASE_URL
    env_key_name = "DEEPSEEK_API_KEY"
