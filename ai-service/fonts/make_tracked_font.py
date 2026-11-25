"""Build PublicSansTracked-Bold.ttf: Public Sans Bold with 0.18em of
letter-spacing built into every glyph's advance width.

The CV's section labels are tracked 0.18em. Drawn with PDF character
spacing (Tc), that space is a gap between glyph boxes, and PyMuPDF and
pdfminer — what resume parsers use to read a PDF — then extract the label
as "E X P E R I E N C E". With the spacing inside the advance width the
box spans it, and every extractor reads "EXPERIENCE" (checked 2026-10-14;
Tc above 0.08em splits in pdfminer). The outlines are unchanged; only the
right side bearing grows. The OFL allows modified versions (Public Sans
declares no Reserved Font Name); this one is renamed anyway.

Dev-only (fontTools isn't a service requirement). Re-run if the spacing or
the source font changes:  pip install fonttools && python make_tracked_font.py
"""

from pathlib import Path

from fontTools.ttLib import TTFont

TRACKING_EM = 0.18
HERE = Path(__file__).resolve().parent
SOURCE = HERE / "PublicSans-Bold.ttf"
OUTPUT = HERE / "PublicSansTracked-Bold.ttf"
FAMILY = "Public Sans Tracked"


def main() -> None:
    font = TTFont(SOURCE)
    extra = round(TRACKING_EM * font["head"].unitsPerEm)
    hmtx = font["hmtx"]
    for glyph, (advance, lsb) in hmtx.metrics.items():
        if advance:  # combining marks keep zero width
            hmtx.metrics[glyph] = (advance + extra, lsb)
    font["hhea"].advanceWidthMax += extra

    name = font["name"]
    for record in name.names:
        if record.nameID in (1, 16):
            record.string = FAMILY
        elif record.nameID == 4:
            record.string = f"{FAMILY} Bold"
        elif record.nameID == 6:
            record.string = "PublicSansTracked-Bold"
        elif record.nameID == 3:
            record.string = f"{record.toUnicode()};tracked-{TRACKING_EM}em"
    font.save(OUTPUT)
    print(f"wrote {OUTPUT.name}: +{extra} units per glyph")


if __name__ == "__main__":
    main()
