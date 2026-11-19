from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parent.parent
for f in (root/'.render').glob('*.png'):
    if f.stem not in ('terra','celeste','meridian','orion','solene','rune','linea','arc','atelier'): continue
    image=Image.open(f).convert('RGB')
    image.save(root/'public'/'looks'/(f.stem+'.webp'), quality=87 if f.stem=='atelier' else 84, method=6)
