"""Package the existing raster mark for Android's native launch screen.
Run manually with Pillow; preserve the original raster letter shapes.
"""
from collections import Counter
from pathlib import Path
import json
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = Image.open(root / 'public/favicon.png').convert('RGBA')
background = Counter(source.getdata()).most_common(1)[0][0]
color = '#%02x%02x%02x' % background[:3]
# Lift the black raster lettering off its noisy yellow background so the
# source image cannot leave a visible rectangle on the native splash.
mark_source = Image.new('RGBA', source.size)
alpha = []
for red, green, blue, opacity in source.getdata():
    coverage = round(255 * (1 - min(red / background[0], green / background[1], 1)))
    alpha.append((0, 0, 0, coverage if coverage >= 8 else 0))
mark_source.putdata(alpha)
for size in (192, 512):
    icon = Image.new('RGBA', (size, size), background)
    width = round(size * .70)
    mark = mark_source.resize((width, round(width * source.height / source.width)), Image.Resampling.LANCZOS)
    icon.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    icon.convert('RGB').save(root / f'public/app-icon-{size}.png', optimize=True)
manifest_path = root / 'public/manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['background_color'] = color
manifest['theme_color'] = color
manifest['icons'] = [dict(src=f'./app-icon-{n}.png', sizes=f'{n}x{n}', type='image/png', purpose='any maskable') for n in (192, 512)]
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print('Native launch background:', color)
