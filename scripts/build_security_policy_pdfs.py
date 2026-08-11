from __future__ import annotations

import html
import re
import shutil
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)


ROOT = Path(__file__).resolve().parents[1]
POLICY_DIR = ROOT / "docs" / "security" / "policies"
OUTPUT_DIR = ROOT / "output" / "pdf" / "security"
PUBLIC_DIR = ROOT / "web" / "assets" / "policies"
LOGO = ROOT / "web" / "assets" / "logo-512.png"

INK = colors.HexColor("#17181C")
ACCENT = colors.HexColor("#B9541E")
MUTED = colors.HexColor("#68676D")
LINE = colors.HexColor("#DDD9D0")
CREAM = colors.HexColor("#F7F5F0")

FILE_NAMES = {
    "01-information-security-program.md": "CaughtUp-Information-Security-Program.pdf",
    "02-network-and-endpoint-security.md": "CaughtUp-Network-and-Endpoint-Security-Policy.pdf",
    "03-access-control.md": "CaughtUp-Access-Control-Policy.pdf",
    "04-data-classification-and-encryption.md": "CaughtUp-Data-Classification-and-Encryption-Policy.pdf",
    "05-incident-response-and-breach-notification.md": "CaughtUp-Incident-Response-and-Breach-Notification-Policy.pdf",
    "06-vulnerability-and-threat-management.md": "CaughtUp-Vulnerability-and-Threat-Management-Policy.pdf",
    "07-personal-data-protection-and-deletion.md": "CaughtUp-Personal-Data-Protection-and-Deletion-Policy.pdf",
}


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("Title", parent=base["Title"], fontName="Helvetica-Bold", fontSize=25, leading=30, textColor=INK, alignment=TA_CENTER, spaceAfter=18),
        "subtitle": ParagraphStyle("Subtitle", parent=base["BodyText"], fontName="Helvetica", fontSize=11, leading=16, textColor=MUTED, alignment=TA_CENTER, spaceAfter=12),
        "h1": ParagraphStyle("H1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=21, leading=26, textColor=INK, spaceBefore=4, spaceAfter=13),
        "h2": ParagraphStyle("H2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=ACCENT, spaceBefore=12, spaceAfter=7),
        "body": ParagraphStyle("Body", parent=base["BodyText"], fontName="Helvetica", fontSize=9.6, leading=14, textColor=INK, spaceAfter=8),
        "meta": ParagraphStyle("Meta", parent=base["BodyText"], fontName="Helvetica", fontSize=9, leading=13, textColor=MUTED, spaceAfter=4),
        "bullet": ParagraphStyle("Bullet", parent=base["BodyText"], fontName="Helvetica", fontSize=9.4, leading=13.5, textColor=INK, leftIndent=2),
    }


ST = styles()


def esc(value: str) -> str:
    return html.escape(value, quote=False)


def parse_markdown(path: Path, include_title: bool = True):
    lines = path.read_text(encoding="utf-8").splitlines()
    story = []
    paragraph = []
    bullets = []

    def flush_paragraph():
        nonlocal paragraph
        if paragraph:
            value = " ".join(part.strip() for part in paragraph)
            story.append(Paragraph(esc(value), ST["body"]))
            paragraph = []

    def flush_bullets():
        nonlocal bullets
        if bullets:
            items = [ListItem(Paragraph(esc(item), ST["bullet"]), leftIndent=12) for item in bullets]
            story.append(ListFlowable(items, bulletType="bullet", start="circle", leftIndent=18, bulletFontName="Helvetica", bulletFontSize=6, bulletColor=ACCENT, spaceAfter=8))
            bullets = []

    for raw in lines:
        line = raw.strip()
        if not line:
            flush_paragraph()
            flush_bullets()
            continue
        if line.startswith("# "):
            flush_paragraph(); flush_bullets()
            if include_title:
                story.append(Paragraph(esc(line[2:]), ST["h1"]))
        elif line.startswith("## "):
            flush_paragraph(); flush_bullets()
            story.append(Paragraph(esc(line[3:]), ST["h2"]))
        elif line.startswith("- "):
            flush_paragraph()
            bullets.append(line[2:])
        elif re.match(r"^[A-Za-z ]+: ", line):
            flush_paragraph(); flush_bullets()
            label, value = line.split(": ", 1)
            story.append(Paragraph(f"<b>{esc(label)}:</b> {esc(value)}", ST["meta"]))
        else:
            flush_bullets()
            paragraph.append(line)
    flush_paragraph(); flush_bullets()
    return story


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = LETTER
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(0.7 * inch, height - 0.55 * inch, width - 0.7 * inch, height - 0.55 * inch)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(INK)
    canvas.drawString(0.7 * inch, height - 0.42 * inch, "CAUGHTUP SECURITY AND PRIVACY")
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(width - 0.7 * inch, 0.42 * inch, f"Page {doc.page}")
    canvas.drawString(0.7 * inch, 0.42 * inch, "Effective August 10, 2026")
    canvas.restoreState()


def document(path: Path, story, title: str):
    doc = SimpleDocTemplate(str(path), pagesize=LETTER, rightMargin=0.72 * inch, leftMargin=0.72 * inch, topMargin=0.78 * inch, bottomMargin=0.72 * inch, title=title, author="CaughtUp")
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)


def cover(title: str, subtitle: str):
    logo = Image(str(LOGO), width=0.85 * inch, height=0.85 * inch)
    logo.hAlign = "CENTER"
    return [Spacer(1, 0.8 * inch), logo, Spacer(1, 0.25 * inch), Paragraph(esc(title), ST["title"]), Paragraph(esc(subtitle), ST["subtitle"]), Spacer(1, 0.15 * inch), Paragraph("Owner: CaughtUp owner and operator", ST["subtitle"]), Paragraph("Security and privacy contact: support@getcaughtup.io", ST["subtitle"]), Paragraph("Effective date: August 10, 2026", ST["subtitle"]), Paragraph("Review cycle: At least annually and after material changes", ST["subtitle"])]


def build():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    policy_paths = [POLICY_DIR / name for name in FILE_NAMES]

    combined_story = cover("CaughtUp Security and Privacy Program", "Information security, access control, data protection, incident response, vulnerability management, and deletion procedures")
    combined_story.append(PageBreak())
    for index, path in enumerate(policy_paths):
        combined_story.extend(parse_markdown(path))
        if index < len(policy_paths) - 1:
            combined_story.append(PageBreak())
    combined = OUTPUT_DIR / "CaughtUp-Security-and-Privacy-Program.pdf"
    document(combined, combined_story, "CaughtUp Security and Privacy Program")

    for path in policy_paths:
        title = path.read_text(encoding="utf-8").splitlines()[0].removeprefix("# ")
        story = cover(title, "CaughtUp adopted policy")
        story.append(PageBreak())
        story.extend(parse_markdown(path, include_title=False))
        destination = OUTPUT_DIR / FILE_NAMES[path.name]
        document(destination, story, title)

    answer_source = ROOT / "docs" / "security" / "tiktok-questionnaire-answer-sheet.md"
    answer_pdf = OUTPUT_DIR / "CaughtUp-TikTok-Security-Questionnaire-Answer-Sheet.pdf"
    answer_story = cover("TikTok Shop Security Questionnaire", "Answer and evidence mapping for CaughtUp")
    answer_story.append(PageBreak())
    ST["body"].fontSize = 8.7
    ST["body"].leading = 12.1
    ST["body"].spaceAfter = 5
    answer_story.extend(parse_markdown(answer_source, include_title=False))
    document(answer_pdf, answer_story, "CaughtUp TikTok Shop Security Questionnaire")

    for pdf in OUTPUT_DIR.glob("*.pdf"):
        shutil.copyfile(pdf, PUBLIC_DIR / pdf.name)
        print(f"{pdf.name}\t{pdf.stat().st_size}")


if __name__ == "__main__":
    build()
