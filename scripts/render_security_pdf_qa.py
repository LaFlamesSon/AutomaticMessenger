from __future__ import annotations

import math
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "output" / "pdf" / "security"
DEST = ROOT / ".tmp" / "security-pdf-qa"


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for pdf_path in sorted(SOURCE.glob("*.pdf")):
        pdf = pdfium.PdfDocument(str(pdf_path))
        pages = []
        for page in pdf:
            bitmap = page.render(scale=1.25)
            image = bitmap.to_pil().convert("RGB")
            image.thumbnail((408, 528), Image.Resampling.LANCZOS)
            pages.append(image)
        columns = min(4, max(1, len(pages)))
        rows = math.ceil(len(pages) / columns)
        sheet = Image.new("RGB", (columns * 428, rows * 558), "#D9D5CD")
        draw = ImageDraw.Draw(sheet)
        for index, page in enumerate(pages):
            x = (index % columns) * 428 + 10
            y = (index // columns) * 558 + 10
            sheet.paste(page, (x, y))
            draw.text((x, y + 530), f"Page {index + 1}", fill="#17181C")
        target = DEST / f"{pdf_path.stem}-contact.png"
        sheet.save(target, optimize=True)
        print(f"{pdf_path.name}\tpages={len(pages)}\t{target.name}")


if __name__ == "__main__":
    main()
