#!/usr/bin/env python3
"""Builds docs/samples/sample-boundary-sketch.pdf: a FICTIONAL boundary sketch of
the demo lot at 1" = 30' on an 11x17 sheet, drawn rotated 8 degrees on the sheet
(like a survey drawn to its deed meridian) so the demo's import, scale and
rotate tools have something real to align. Not a survey. Needs reportlab."""
import math
import os

from reportlab.lib.pagesizes import landscape, TABLOID
from reportlab.pdfgen import canvas

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "samples", "sample-boundary-sketch.pdf")
SCALE_FT_PER_IN = 30.0
PT = 72.0 / SCALE_FT_PER_IN          # points per foot
ROT = math.radians(8.0)              # lot drawn rotated 8 deg CCW on the sheet
ORIGIN = (4.2 * 72, 2.2 * 72)        # sheet position of the lot's SW corner (points)

LOT = [(0, 0), (220, 0), (220, 120), (150, 170), (0, 170)]
POND = [(175, 115), (200, 108), (212, 118), (195, 135), (178, 132)]
SHED = [(30, 128), (46, 128), (46, 140), (30, 140)]
DRIVE = [(96, 0), (108, 0), (108, 40), (96, 40)]
TREES = [(60, 150, 9), (120, 145, 11), (14, 60, 8)]


def sheet(x, y):
    c, s = math.cos(ROT), math.sin(ROT)
    return ORIGIN[0] + (c * x - s * y) * PT, ORIGIN[1] + (s * x + c * y) * PT


def poly(cv, pts, close=True, fill=0):
    p = cv.beginPath()
    p.moveTo(*sheet(*pts[0]))
    for q in pts[1:]:
        p.lineTo(*sheet(*q))
    if close:
        p.close()
    cv.drawPath(p, stroke=1, fill=fill)


def label(cv, x, y, text, size=8, ang=0.0):
    cv.saveState()
    cv.translate(*sheet(x, y))
    cv.rotate(math.degrees(ROT) + ang)
    cv.setFont("Helvetica", size)
    cv.drawCentredString(0, 0, text)
    cv.restoreState()


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    W, H = landscape(TABLOID)
    cv = canvas.Canvas(OUT, pagesize=(W, H))
    cv.setTitle("Sample boundary sketch (fictional)")
    cv.setLineWidth(1.6)
    cv.rect(0.4 * 72, 0.4 * 72, W - 0.8 * 72, H - 0.8 * 72)
    # lot
    cv.setLineWidth(2.2)
    poly(cv, LOT)
    cv.setLineWidth(0.8)
    for (a, b) in zip(LOT, LOT[1:] + LOT[:1]):
        L = math.dist(a, b)
        ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        nx, ny = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
        if ang > 90 or ang < -90:
            ang += 180
        label(cv, mx + nx * 6, my + ny * 6, f"{L:.2f}'", 9, ang)
    # pond, shed, drive, trees
    cv.setDash(4, 2)
    poly(cv, POND)
    cv.setDash()
    label(cv, 192, 121, "POND", 7)
    poly(cv, SHED)
    label(cv, 38, 132, "SHED", 6)
    cv.setDash(2, 2)
    poly(cv, DRIVE)
    cv.setDash()
    label(cv, 102, 18, "DRIVE", 6, 90)
    for (x, y, r) in TREES:
        cx, cy = sheet(x, y)
        cv.circle(cx, cy, r * PT, stroke=1, fill=0)
        label(cv, x, y - 1.2, "OAK", 6)
    # calibration dimension along the front line
    cv.setLineWidth(0.6)
    a, b = sheet(0, -14), sheet(220, -14)
    cv.line(*a, *b)
    for x in (0, 220):
        cv.line(*sheet(x, -10), *sheet(x, -18))
        p, q = sheet(x - 2, -16), sheet(x + 2, -12)
        cv.line(*p, *q)
    label(cv, 110, -12.5, "220.00'  (CHECK DIMENSION)", 9)
    label(cv, 110, -26, "STREET (FICTIONAL)", 10)
    # north arrow (rotated with the drawing) and graphic scale
    nx, ny = sheet(250, 150)
    cv.saveState(); cv.translate(nx, ny); cv.rotate(math.degrees(ROT))
    p = cv.beginPath(); p.moveTo(0, 30); p.lineTo(-8, 0); p.lineTo(8, 0); p.close(); cv.drawPath(p, fill=1)
    cv.setFont("Helvetica-Bold", 12); cv.drawCentredString(0, -14, "N")
    cv.restoreState()
    x0, y0 = W - 5.6 * 72, 1.05 * 72
    for i, ft in enumerate((0, 30, 60, 90, 120)):
        if i < 4:
            cv.rect(x0 + ft * PT, y0, 30 * PT, 6, fill=(i % 2 == 0))
        cv.setFont("Helvetica", 8)
        cv.drawCentredString(x0 + ft * PT, y0 + 10, f"{ft}'")
    cv.setFont("Helvetica-Bold", 10)
    cv.drawString(x0, y0 - 14, 'SCALE: 1" = 30\'   (11x17 sheet)')
    # title
    cv.setFont("Helvetica-Bold", 14)
    cv.drawString(0.7 * 72, H - 0.85 * 72, "SAMPLE BOUNDARY SKETCH")
    cv.setFont("Helvetica", 9)
    cv.drawString(0.7 * 72, H - 1.05 * 72, "FICTIONAL LOT FOR THE FIELDCOMM DRAW DEMO. NOT A SURVEY. Drawn rotated 8 degrees on the sheet.")
    cv.drawString(0.7 * 72, H - 1.22 * 72, "Lot lines in feet. Origin (0,0) = SW lot corner.")
    cv.showPage()
    cv.save()
    print("wrote", OUT)


if __name__ == "__main__":
    main()
