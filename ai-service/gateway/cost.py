"""Token 用量记录模块。

每次请求完成后，将 usage stats 写入日志文件（JSON Lines 格式）。
API key 不出现在日志中。
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from config import settings
from models.normalized import UsageStats

logger = logging.getLogger(__name__)


def log_usage(model: str, usage: UsageStats) -> None:
    """将单次请求的 token 用量追加写入 usage.jsonl。

    Args:
        model: 模型名称（如 "claude-sonnet-4-6"）。
        usage: token 用量统计。

    日志路径由 settings.log_dir 决定，确保为绝对路径，
    服务从任意目录启动均可正常写入。
    """
    try:
        log_path = Path(settings.log_dir) / "usage.jsonl"
        log_path.parent.mkdir(parents=True, exist_ok=True)

        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "model": model,
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cache_read": usage.cache_read_input_tokens,
            "cache_creation": usage.cache_creation_input_tokens,
        }

        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    except Exception as exc:
        # 日志写入失败不应影响主请求，仅记录警告
        logger.warning("Failed to write usage log: %s", exc)
