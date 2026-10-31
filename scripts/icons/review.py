"""Generate paginated visual QA sheets from the rendered icon manifest.
Run after build.mjs: python3 scripts/icons/review.py (requires Pillow).
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
out = root / 'design/beverage-icons'
records = json.loads((out / 'manifest.json').read_text())['records']
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 14)

def tile(record, size, background):
    result = Image.new('RGBA', (size, size), background)
    im = Image.open(out / record['assets']['png']).convert('RGBA')
    im.thumbnail((round(size * .84), round(size * .84)), Image.Resampling.LANCZOS)
    result.alpha_composite(im, ((size-im.width)//2, (size-im.height)//2))
    return result

for page, start in enumerate(range(0, len(records), 12), 1):
    batch = records[start:start+12]
    sheet = Image.new('RGB', (900, ((len(batch)+2)//3)*330), '#f8f6f2')
    draw = ImageDraw.Draw(sheet)
    for i, record in enumerate(batch):
        x, y = (i%3)*300, (i//3)*330
        im = Image.open(out / record['assets']['png']).convert('RGBA')
        im.thumbnail((185, 240), Image.Resampling.LANCZOS)
        sheet.paste(im, (x+(300-im.width)//2, y+12), im)
        label = record['name']
        if len(label)>36: label=label[:34]+'…'
        draw.text((x+15,y+262), label, font=font, fill='#493657')
        sheet.paste(tile(record,40,'#eee9f2'),(x+50,y+286))
        sheet.paste(tile(record,56,'#eee9f2'),(x+170,y+275))
    sheet.save(out / 'review' / f'overview-{page:02}.png')

for page, start in enumerate(range(0,len(records),6),1):
    batch = records[start:start+6]
    sheet = Image.new('RGB',(len(batch)*210,850),'#faf7f2')
    draw = ImageDraw.Draw(sheet)
    for row, background in enumerate(['#eee9f2','#292630']):
        for i, record in enumerate(batch):
            draw.text((i*210+10,row*425+8),record['brand']+' / '+record['slug'].split('-')[-1],font=font,fill='#493657')
            y=row*425+35
            for size in [40,56,96,155]:
                sheet.paste(tile(record,size,background),(i*210+(210-size)//2,y))
                y+=size+12
    sheet.save(out/'review'/f'sizes-{page:02}.png')
print(f'Review sheets created for {len(records)} icons.')
