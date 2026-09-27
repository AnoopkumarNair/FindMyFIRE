#!/usr/bin/env python3
"""Turn RBI's city-wise House Price Index (a spreadsheet saved from the quarterly release) into
data/house-price-index.json for the Property section.

    python3 scripts/import-hpi.py <file.xlsx> [--release-url URL]

Expects one sheet with the columns City, State/Region, HPI_Q<n>_<yyyy>_<yy> (index, 2022-23 = 100),
QoQ_Growth_Percent and YoY_Growth_Percent, and an 'ALL INDIA' row. Needs openpyxl.
"""
import json, re, sys
from datetime import date
import openpyxl

BASE_MID = date(2022, 10, 1)  # middle of the base year 2022-23 (index = 100)
STATE_NAMES = {"Chandigarh UT": "Chandigarh", "Delhi NCR": "Delhi"}


def quarter_mid(q, fy_start):
    """Middle of a financial-year quarter: Q1 = Apr–Jun of fy_start, ..., Q4 = Jan–Mar of fy_start + 1."""
    month = 3 * (q - 1) + 5  # May, Aug, Nov, Feb(+12)
    year = fy_start + (month - 1) // 12
    return date(year, (month - 1) % 12 + 1, 15)


def main(path, release_url):
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    rows = [r for r in ws.iter_rows(values_only=True) if any(c is not None for c in r)]
    head = [str(c).strip() for c in rows[0]]
    col = {name: head.index(name) for name in ("City", "State/Region", "QoQ_Growth_Percent", "YoY_Growth_Percent")}
    hpi = next(i for i, h in enumerate(head) if re.fullmatch(r"HPI_Q[1-4]_\d{4}_\d{2}", h))
    q, fy = re.fullmatch(r"HPI_Q([1-4])_(\d{4})_\d{2}", head[hpi]).groups()
    mid = quarter_mid(int(q), int(fy))
    years = (mid - BASE_MID).days / 365.25

    def entry(r):
        index, qoq, yoy = float(r[hpi]), float(r[col["QoQ_Growth_Percent"]]), float(r[col["YoY_Growth_Percent"]])
        assert 50 < index < 250 and -30 < qoq < 30 and -40 < yoy < 60, f"implausible row: {r}"
        return {"index": index, "qoqPercent": qoq, "yoyPercent": yoy,
                "annualSinceBase": round((index / 100) ** (1 / years) - 1, 4)}

    cities, all_india = [], None
    for r in rows[1:]:
        name, state = str(r[col["City"]]).strip(), str(r[col["State/Region"]]).strip()
        if name.upper() == "ALL INDIA":
            all_india = entry(r)
            continue
        cities.append({"city": name, "state": STATE_NAMES.get(state, state), **entry(r)})
    assert all_india, "no ALL INDIA row"
    assert len(cities) >= 10, f"only {len(cities)} cities"

    states = {}
    for c in cities: states.setdefault(c["state"], []).append(c)
    by_state = [{"state": s, "cities": [c["city"] for c in cs],
                 "annualSinceBase": round(sum(c["annualSinceBase"] for c in cs) / len(cs), 4),
                 "yoyPercent": round(sum(c["yoyPercent"] for c in cs) / len(cs), 1)}
                for s, cs in sorted(states.items())]
    out = {
        "source": {"title": f"RBI House Price Index, Q{q} {fy}-{str(int(fy) + 1)[2:]}", "publisher": "Reserve Bank of India",
                   "url": release_url, "base": "2022-23 = 100", "quarter": f"Q{q} {fy}-{str(int(fy) + 1)[2:]}",
                   "importedOn": date.today().isoformat()},
        "yearsSinceBase": round(years, 2),
        "note": "Nominal prices from property registrations. The yearly rate since 2022-23 covers only a few years; long-run growth is usually closer to inflation, with long flat spells.",
        "allIndia": all_india,
        "cities": sorted(cities, key=lambda c: (c["state"], c["city"])),
        "states": by_state,
    }
    with open("data/house-price-index.json", "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"{len(cities)} cities in {len(by_state)} states, Q{q} {fy}, {years:.2f} years since the base; all-India {all_india}")


if __name__ == "__main__":
    args = sys.argv[1:]
    url = args[args.index("--release-url") + 1] if "--release-url" in args else "https://www.rbi.org.in"
    main(args[0], url)
