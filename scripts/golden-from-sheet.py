"""Regenerate test/fixtures/sheet-golden.json from the original workbook.

Types synthetic inputs into a copy of the sheet, recalculates it with LibreOffice,
and records the FIRE_Engine outputs the JS engine must reproduce.
The workbook itself holds personal data and is never committed.

Usage: python3 scripts/golden-from-sheet.py /path/to/MyFIRE.xlsx
Needs: pip install openpyxl; LibreOffice Calc (soffice) on PATH.
"""
import json, os, subprocess, sys, tempfile
import openpyxl

src = sys.argv[1]
inp = {"currentAge": 38, "fireAge": 50, "annualExpenses": 1200000, "generalInflation": 0.06,
       "healthInflation": 0.1, "healthShare": 0.15, "returnBefore": 0.115, "returnAfter": 0.1,
       "swr": 0.0325, "corpus": 6000000, "annualSip": 480000,
       "leanShare": 0.7, "bucketReturns": {"cash": 0.065, "debt": 0.075},
       "milestones": [{"age": 44, "amount": -1500000}, {"age": 50, "amount": 1000000}]}

wb = openpyxl.load_workbook(src)
fe = wb["FIRE_Engine"]
fe["B4"], fe["B5"], fe["B7"] = inp["currentAge"], inp["fireAge"], inp["annualExpenses"]
fe["B8"], fe["B9"], fe["B10"] = inp["generalInflation"], inp["healthInflation"], inp["healthShare"]
fe["B12"], fe["B13"], fe["E13"] = inp["returnBefore"], inp["returnAfter"], inp["swr"]
fe["E9"], fe["E10"] = inp["corpus"], inp["annualSip"]
for r in (6, 7, 10, 11, 12, 13, 14):  # milestone rows summed by M9
    fe[f"M{r}"], fe[f"L{r}"] = 0, inp["fireAge"]
for r, m in zip((6, 7), inp["milestones"]):
    fe[f"L{r}"], fe[f"M{r}"] = m["age"], m["amount"]
eb = wb["Expenses_Budget"]
eb["A4"], eb["C4"] = 1000000, 1000000 * inp["leanShare"]

tmp = tempfile.mkdtemp()
path = os.path.join(tmp, "golden-in.xlsx")
wb.save(path)
subprocess.run(["soffice", f"-env:UserInstallation=file://{tmp}/profile", "--headless",
                "--convert-to", "xlsx", "--outdir", os.path.join(tmp, "out"), path], check=True)
v = openpyxl.load_workbook(os.path.join(tmp, "out", "golden-in.xlsx"), data_only=True)["FIRE_Engine"]

cells = ["B6", "B11", "B14", "B15", "B16", "B17", "E4", "E5", "E6", "F6", "E7", "F7",
         "E11", "M9", "E15", "E16", "E17", "E18", "F14", "E14"]
cols = dict(age="B", begin="D", withdrawal="E", cash="F", debt="G", equity="H", growth="I", end="J")
schedule, r = [], 22
while isinstance(v[f"B{r}"].value, (int, float)):
    schedule.append({k: v[f"{c}{r}"].value for k, c in cols.items()})
    r += 1

out = {"_about": "Synthetic inputs typed into the original Google Sheet (FIRE_Engine tab) and recalculated "
                 "with LibreOffice. No personal data. Regenerate with scripts/golden-from-sheet.py if the sheet logic changes.",
       "inputs": inp, "outputs": {c: v[c].value for c in cells}, "schedule": schedule}
dest = os.path.join(os.path.dirname(__file__), "..", "test", "fixtures", "sheet-golden.json")
with open(dest, "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
print(f"wrote {dest} ({len(schedule)} schedule rows)")
