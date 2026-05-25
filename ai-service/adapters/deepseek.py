"""DeepSeek Adapter。

DeepSeek API 与 OpenAI 格式兼容，直接复用 OpenAIAdapter，
仅 base_url 不同。
"""

from adapters.openai import OpenAIAdapter


class DeepSeekAdapter(OpenAIAdapter):
    provider = "deepseek"
    BASE_URL: str = "https://api.deepseek.com/v1/chat/completions"
