from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
for source in (root / ".render").glob("*.png"):
    image = Image.open(source).convert("RGB")
    image.save(root / "public" / "looks" / f"{source.stem}.webp", "WEBP",
               quality=89 if source.stem == "studio" else 85, method=6)
