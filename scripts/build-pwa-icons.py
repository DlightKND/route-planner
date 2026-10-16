"""Package the supplied full wordmark for the native PWA launch screen.
Run manually with Pillow. Keep the favicon independent and never upscale
this raster source; the checked-in assets do not require Pillow in CI.
"""
from hashlib import sha256
from pathlib import Path
import json
import re
from PIL import Image

root = Path(__file__).resolve().parents[1]
source_path = root / 'public/launch-logo.png'
source = Image.open(source_path).convert('RGBA')
background = max(source.getcolors(source.width * source.height), key=lambda entry: entry[0])[1]
color = '#%02x%02x%02x' % background[:3]
# Icon URLs must change with the artwork so installed WebAPKs can detect it.
version = sha256(source_path.read_bytes()).hexdigest()[:10]
manifest_path = root / 'public/manifest.json'
manifest = json.loads(manifest_path.read_text())
previous_icons = [icon['src'] for icon in manifest['icons']]
icons = []
for size in (192, 512):
    icon = Image.new('RGBA', (size, size), background)
    width = min(source.width, round(size * .70))
    mark = source if width == source.width else source.resize(
        (width, round(width * source.height / source.width)), Image.Resampling.LANCZOS)
    icon.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    name = f'launch-icon-{version}-{size}.png'
    icon.convert('RGB').save(root / 'public' / name, optimize=True)
    icons.append(dict(src=f'./{name}', sizes=f'{size}x{size}', type='image/png', purpose='any maskable'))
manifest.update(background_color=color, theme_color=color, icons=icons)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
index_path = root / 'index.html'
index = index_path.read_text()
index = re.sub(r'(<link rel="apple-touch-icon" href=")[^"]+', r'\g<1>' + icons[0]['src'][2:], index)
index = re.sub(r'(<meta name="theme-color" content=")[^"]+', r'\g<1>' + color, index)
index_path.write_text(index)
for previous in previous_icons:
    if previous not in [icon['src'] for icon in icons] and re.fullmatch(r'\./(?:app-icon-\d+|launch-icon-[a-f0-9]+-\d+)\.png', previous):
        (root / 'public' / previous[2:]).unlink(missing_ok=True)
print('Native launch background:', color)
print('Native launch icons:', ', '.join(icon['src'] for icon in icons))
