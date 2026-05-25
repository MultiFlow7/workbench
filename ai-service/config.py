"""环境变量读取与服务配置。"""

import os
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """从环境变量读取配置，支持 .env 文件。"""

    # 服务配置
    host: str = "0.0.0.0"
    port: int = 8000

    # 日志目录：默认为服务根目录下 logs/，确保绝对路径
    log_dir: str = str(Path(__file__).parent / "logs")

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
        "extra": "ignore",
    }


settings = Settings()
