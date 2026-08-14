"""ค่าตั้งต้นร่วมของชุดทดสอบ"""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
APP_PATH = str(PROJECT_ROOT / "app.py")

# ให้ทดสอบ import แพ็กเกจ core / ui ได้ไม่ว่าจะรัน pytest จากที่ไหน
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
