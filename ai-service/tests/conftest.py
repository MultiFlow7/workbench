"""pytest 配置：把 ai-service/ 目录加入 sys.path，使 providers/ 可被绝对导入。"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
