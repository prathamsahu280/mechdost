"""
Re-read the maker price lists (catalogue-v2 import, design 2026-11-22) and write every MRP row they hold as JSON:
  {"file": ..., "page": n, "brand": ..., "product": ..., "pack": ..., "mrpRupees": n}
`import-catalogue` only uses these to fill packs that catalogue-v2 left without an MRP, on exact brand + product + pack
matches. The PDFs and spreadsheet are untrusted data: this script only reads them (pymupdf, openpyxl), never runs
anything from them. Run it isolated (`python -I`) from a scratch directory:

  python -I packages/db/scripts/extract-price-lists.py --dir C:/Users/Admin/Downloads --out price-lists.json

Files it knows (matched by name fragment): Gulf price circular, Exide MRCP, Tata Green 4W / TT-HUPS, KELVINN, the
"Lube order form" workbook. The Castrol list is image-only (no text layer, no OCR here); catalogue-v2 already holds
every Castrol MRP (checked 2026-11-22), so nothing is lost.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import openpyxl
import pymupdf

NUM = re.compile(r"^[0-9][0-9,]*(\.[0-9]+)?$")


def num(text):
    t = text.strip().replace(",", "")
    return float(t) if re.fullmatch(r"[0-9]+(\.[0-9]+)?", t) else None


def lines_of(page):
    return [ln.strip() for ln in page.get_text("text").split("\n") if ln.strip()]


def gulf(path):
    rows = []
    doc = pymupdf.open(path)
    for pno, page in enumerate(doc, start=1):
        ls = lines_of(page)
        i = 0
        while i + 8 < len(ls):
            cat, brand, sub, grade, oil, sku, mrp, sdp, sdpl = ls[i : i + 9]
            if (
                num(sku) is not None
                and num(mrp) is not None
                and num(sdp) is not None
                and num(sdpl) is not None
                and num(oil) is None
                and num(sub) is None
            ):
                rows.append(
                    {
                        "file": path.name,
                        "page": pno,
                        "brand": "Gulf",
                        "product": sub,
                        "pack": f"{num(sku):g} L",
                        "mrpRupees": num(mrp),
                    }
                )
                i += 9
            else:
                i += 1
    return rows


def code_list(path, brand, wanted_warranty):
    """Exide MRCP / Tata Green: records are `code, warranty, price` line triples."""
    rows = []
    doc = pymupdf.open(path)
    for pno, page in enumerate(doc, start=1):
        ls = lines_of(page)
        for i in range(1, len(ls) - 1):
            if re.fullmatch(wanted_warranty, ls[i]) and NUM.match(ls[i + 1]) and not NUM.match(ls[i - 1]):
                price = num(ls[i + 1])
                if price:
                    rows.append(
                        {
                            "file": path.name,
                            "page": pno,
                            "brand": brand,
                            "product": ls[i - 1],
                            "pack": ls[i - 1],
                            "mrpRupees": price,
                        }
                    )
    return rows


def kelvinn(path):
    rows = []
    doc = pymupdf.open(path)
    for pno, page in enumerate(doc, start=1):
        ls = lines_of(page)
        for i in range(len(ls) - 4):
            m = re.match(r"^(KELVINN .+?)\s*\((\d+)\s*X.*\)", ls[i], re.I) or re.match(r"^(KELVINN .+)$", ls[i], re.I)
            if not m:
                continue
            # layout: name, cartons, "X", pack, MRP, ...
            if ls[i + 2] == "X" and num(ls[i + 1]) is not None and num(ls[i + 4]) is not None:
                rows.append(
                    {
                        "file": path.name,
                        "page": pno,
                        "brand": "KELVINN",
                        "product": re.sub(r"\s*\(.*$", "", ls[i]).strip(),
                        "pack": ls[i + 3].strip(),
                        "mrpRupees": num(ls[i + 4]),
                    }
                )
    return rows


def lube_xlsx(path):
    rows = []
    wb = openpyxl.load_workbook(path, data_only=True)
    for ws in wb:
        for n, r in enumerate(ws.iter_rows(values_only=True), start=1):
            if len(r) > 8 and isinstance(r[1], (int, float)) and isinstance(r[5], str):
                if isinstance(r[7], (int, float)) and isinstance(r[8], (int, float)) and r[8] > 0:
                    rows.append(
                        {
                            "file": path.name,
                            "page": n,  # worksheet row
                            "brand": "",  # the form names no brand; only a name match can use it
                            "product": re.sub(r"\s*\(.*$", "", r[5]).strip(),
                            "pack": f"{r[7]:g} L",
                            "mrpRupees": float(r[8]),
                        }
                    )
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    d = Path(args.dir)
    rows = []
    for f in d.iterdir():
        n = f.name.lower()
        if n.startswith("price list circulation") and n.endswith(".pdf"):
            rows += gulf(f)
        elif n.startswith("mrcp price list for exide"):
            rows += code_list(f, "Exide", r"[0-9]+F\+[0-9]+P")
        elif n.startswith("tgy_mrp"):
            rows += code_list(f, "Tata Green", r"[0-9]+")
        elif n.startswith("kelvinn auto care price list"):
            rows += kelvinn(f)
        elif n.startswith("lube order form") and n.endswith(".xlsx"):
            rows += lube_xlsx(f)
    Path(args.out).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(rows)} price rows from {len({r['file'] for r in rows})} files", file=sys.stderr)


if __name__ == "__main__":
    main()
