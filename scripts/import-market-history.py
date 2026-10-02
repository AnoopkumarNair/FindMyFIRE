#!/usr/bin/env python3
"""Turn downloaded index histories into data/market-history.json for the history replay.

    python3 scripts/import-market-history.py --equity <file>... [--debt <file>...]
        [--equity-name NAME] [--equity-url URL] [--debt-name NAME] [--debt-url URL]

Each file is a CSV or XLSX of daily or monthly index levels, as downloaded from the index
provider (for example NSE Indices' historical data for NIFTY 50 Total Returns Index, and
optionally NIFTY 10 yr Benchmark G-Sec for debt). Several files for one index are merged, so a
history downloaded a year at a time is fine.

A column whose header contains "date" gives the date; the level is taken from a column named
like "Total Returns Index", "TRI", "Close" or "Closing Index Value" (the first one found).

Each calendar year's return is the last level in December over the last level of the previous
December. Years without a December level on both ends are left out. A total-returns index
includes dividends; a price index (such as the plain NIFTY 50 or SENSEX) leaves them out and
understates returns by about 1-1.5% a year, which the source name records.

Inflation isn't imported here: the app uses India's yearly CPI inflation from the World Bank,
fetched at deploy time (scripts/fetch-market-data.mjs).
"""
import argparse, csv, json, re, sys
from datetime import date, datetime

LEVEL_COLUMNS = ["total returns index", "tri", "close", "closing index value", "closing value", "index value", "price"]
DATE_FORMATS = ["%d-%b-%Y", "%d %b %Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%b %d, %Y", "%d-%B-%Y", "%d %B %Y", "%Y/%m/%d"]


def parse_date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    for f in DATE_FORMATS:
        try:
            return datetime.strptime(s, f).date()
        except ValueError:
            pass
    return None


def parse_number(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def rows_of(path):
    if path.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl
        ws = openpyxl.load_workbook(path, data_only=True, read_only=True).worksheets[0]
        return [list(r) for r in ws.iter_rows(values_only=True)]
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [r for r in csv.reader(f)]


def levels(paths):
    """Date → level from all files, checking the files agree where they overlap."""
    out = {}
    for path in paths:
        rows = [r for r in rows_of(path) if r and any(c not in (None, "") for c in r)]
        head_i = next(i for i, r in enumerate(rows) if any("date" in str(c).lower() for c in r))
        head = [str(c or "").strip().lower() for c in rows[head_i]]
        dc = next(i for i, h in enumerate(head) if "date" in h)
        lc = next((head.index(n) for n in LEVEL_COLUMNS if n in head), None)
        if lc is None:
            sys.exit(f"{path}: no level column; headers are {rows[head_i]}")
        n = 0
        for r in rows[head_i + 1:]:
            if len(r) <= max(dc, lc):
                continue
            d, x = parse_date(r[dc]), parse_number(r[lc])
            if d is None or x is None or x <= 0:
                continue
            if d in out and abs(out[d] - x) > 1e-6 * x:
                sys.exit(f"{path}: {d} is {x} here but {out[d]} in another file")
            out[d] = x
            n += 1
        print(f"  {path}: {n} levels, {min(d for d in out)} to {max(d for d in out)}")
    return out


def yearly_returns(lv):
    by_year = {}
    for d in sorted(lv):
        if d.month == 12:
            by_year[d.year] = lv[d]  # last December level of the year
    years = sorted(by_year)
    out = {}
    for y in years:
        if y - 1 in by_year:
            r = by_year[y] / by_year[y - 1] - 1
            assert -0.8 < r < 3, f"implausible return for {y}: {r:.1%}"
            out[y] = round(r, 5)
    return out


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--equity", nargs="+", required=True)
    a.add_argument("--debt", nargs="*", default=[])
    a.add_argument("--equity-name", default="NIFTY 50 Total Returns Index")
    a.add_argument("--equity-url", default="https://www.niftyindices.com/reports/historical-data")
    a.add_argument("--debt-name", default="NIFTY 10 yr Benchmark G-Sec Index")
    a.add_argument("--debt-url", default="https://www.niftyindices.com/reports/historical-data")
    a.add_argument("--out", default="data/market-history.json")
    o = a.parse_args()

    print("Equity:")
    eq = yearly_returns(levels(o.equity))
    debt = {}
    if o.debt:
        print("Debt:")
        debt = yearly_returns(levels(o.debt))
    if len(eq) < 10:
        sys.exit(f"only {len(eq)} complete years of equity returns; the replay needs at least 10")
    years = {str(y): {"equity": eq[y], **({"debt": debt[y]} if y in debt else {})} for y in sorted(eq)}
    data = {
        "source": {
            "equity": {"name": o.equity_name, "url": o.equity_url},
            **({"debt": {"name": o.debt_name, "url": o.debt_url}} if debt else {}),
            "inflation": {"name": "World Bank, India consumer price inflation (FP.CPI.TOTL.ZG)", "url": "https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG?locations=IN"},
            "method": "Calendar-year returns, last December level to last December level.",
            "importedOn": date.today().isoformat(),
        },
        "years": years,
    }
    with open(o.out, "w") as f:
        json.dump(data, f, indent=1)
        f.write("\n")
    ys = sorted(eq)
    print(f"wrote {o.out}: equity {ys[0]}-{ys[-1]} ({len(ys)} years)" + (f", debt {min(debt)}-{max(debt)}" if debt else ", no debt history"))
    worst = sorted(eq.items(), key=lambda kv: kv[1])[:3]
    print("worst equity years (check these against the provider's own figures):", ", ".join(f"{y} {r:.1%}" for y, r in worst))


if __name__ == "__main__":
    main()
