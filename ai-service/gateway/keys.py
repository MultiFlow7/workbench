"""API key 管理模块（BYOK 模式）。

key 来源优先级：请求 header（X-Provider-Key）> 服务端 env var。
后端不持久化 header key，内存使用后即丢弃。
"""

import os
from typing import Optional

# 环境变量名映射（fallback 用）
_ENV_KEY_MAP: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai":    "OPENAI_API_KEY",
    "deepseek":  "DEEPSEEK_API_KEY",
    "gemini":    "GEMINI_API_KEY",
}


def get_key(provider: str, header_key: Optional[str] = None) -> str:
    """获取指定 provider 的 API key。

    BYOK 优先：header_key 非空时直接返回，不读 env var。
    fallback：从 env var 读取；env var 也缺失时抛出 EnvironmentError。

    Raises:
        ValueError: provider 不在支持列表中。
        EnvironmentError: 无 header key 且 env var 未设置或为空。
    """
    if header_key:
        return header_key
    if provider not in _ENV_KEY_MAP:
        raise ValueError(f"Unknown provider: {provider}")
    env_var = _ENV_KEY_MAP[provider]
    key = os.environ.get(env_var)
    if not key:
        raise EnvironmentError(
            f"No X-Provider-Key header and missing env var: {env_var}"
        )
    return key


def validate_all_keys() -> None:
    """检查所有 env var key 是否已配置（可选调用，BYOK 场景下 env 非强制）。"""
    missing = []
    for provider, env_var in _ENV_KEY_MAP.items():
        if not os.environ.get(env_var):
            missing.append(env_var)
    if missing:
        raise EnvironmentError(
            f"Missing API key env vars: {', '.join(missing)}"
        )
