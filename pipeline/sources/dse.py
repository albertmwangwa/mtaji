"""Dar es Salaam Stock Exchange (dse.co.tz): daily trading history and dividend record per listed company.

Each company page is a Next.js page whose server payload embeds the full table:
  trading-history: rows [date, open, high, low, close, volume, turnover]
  dividends:       {"symbol":..,"perShare":..,"announced":..,"booksClosure":..,"payment":..,"href":..}"""
from __future__ import annotations

import json
import re

from ..common import Http

BASE = "https://www.dse.co.tz/en/main-market/company-profile"
ROW = re.compile(r'\[\\"(\d{4}-\d{2}-\d{2})\\",([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+)\]')
DIV = re.compile(r'\{\\?"symbol\\?":\\?"([A-Z0-9-]+)\\?",\\?"perShare\\?":([\d.]+),(.*?)\}')


def _field(blob: str, name: str):
    m = re.search(r'\\?"' + name + r'\\?":(?:\\?"([^"\\]*)\\?"|null)', blob)
    return m.group(1) if m and m.group(1) else None


def history(ticker: str, http: Http) -> list[list]:
    html = http.get(f"{BASE}/{ticker}/trading-history")
    rows = {}
    for m in ROW.finditer(html):
        day, o, h, lo, c, v, t = m.groups()
        rows[day] = [day, float(o), float(h), float(lo), float(c), float(v), float(t)]
    return [rows[k] for k in sorted(rows)]


def dividends(ticker: str, http: Http) -> list[dict]:
    html = http.get(f"{BASE}/{ticker}/dividends")
    out, seen = [], set()
    for m in DIV.finditer(html):
        sym, per, rest = m.group(1), float(m.group(2)), m.group(3)
        if sym != ticker:
            continue
        rec = {"dps": per, "announced": _field(rest, "announced"), "books": _field(rest, "booksClosure"),
               "payment": _field(rest, "payment"), "doc": _field(rest, "href")}
        key = (rec["dps"], rec["announced"], rec["payment"])
        if key not in seen:
            seen.add(key)
            out.append(rec)
    return sorted(out, key=lambda r: r["payment"] or r["announced"] or "", reverse=True)


def fetch(tickers: list[str], http: Http | None = None, log=print) -> dict:
    http = http or Http(pause=0.6)
    out = {}
    for t in tickers:
        try:
            out[t] = {"rows": history(t, http), "divs": dividends(t, http)}
            log(f"  DSE {t}: {len(out[t]['rows'])} sessions, {len(out[t]['divs'])} dividends")
        except Exception as e:      # one bad page must not sink the whole run
            out[t] = {"error": str(e)}
            log(f"  DSE {t}: FAILED {e}")
    return out
