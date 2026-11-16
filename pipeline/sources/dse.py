"""Dar es Salaam Stock Exchange (dse.co.tz): daily trading history and dividend record per listed company.

Each company page is a Next.js page whose server payload embeds the full table:
  trading-history: rows [date, open, high, low, close, volume, turnover]
  dividends:       {"symbol":..,"perShare":..,"announced":..,"booksClosure":..,"payment":..,"href":..}"""
from __future__ import annotations

import datetime as dt
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


# ---------------------------------------------------------------- market-level pages
SITE = "https://www.dse.co.tz/en"


def _json_after(text: str, key: str, start: int = 0):
    """Parse the JSON array/object that follows `key` in an RSC payload (string-aware bracket matching)."""
    i = text.find(key, start)
    if i < 0:
        return None
    j = i + len(key) - 1
    opener = text[j]
    closer = {"[": "]", "{": "}"}[opener]
    depth, k, ins, esc = 0, j, False, False
    while k < len(text):
        ch = text[k]
        if ins:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                ins = False
        elif ch == '"':
            ins = True
        elif ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
            if depth == 0:
                return json.loads(text[j:k + 1])
        k += 1
    return None


def market(http: Http) -> dict:
    """Homepage: indices with a year of daily closes, market statistics, and the price ticker (every listed
    security, ETFs included)."""
    raw = http.get(SITE)
    d = raw.replace('\\"', '"')
    idx, pos = {}, 0
    while True:
        pos = d.find('"indices":[', pos)
        if pos < 0:
            break
        arr = _json_after(d, '"indices":[', pos) or []
        pos += 10
        for o in arr:
            if isinstance(o.get("series"), list) and o.get("name") not in idx:
                idx[o["name"]] = {"name": o["name"], "close": o.get("close"), "change": o.get("change"), "pct": o.get("pct"),
                                  "series": [[dt.datetime.utcfromtimestamp(t).date().isoformat(), v] for t, v in o["series"]]}
    sp = d.find('"stats":{"value"')
    stats = _json_after(d, '"stats":{', sp) if sp >= 0 else {}
    ticker = {}
    for m in re.finditer(r'<li class="flex items-center gap-2\.5[^"]*"><span[^>]*>([^<]+)</span><span[^>]*>([\d,.]+)</span><span class="([^"]*)"[^>]*>(.*?)</span></li>', raw):
        sym, price, cls, chg = m.group(1).strip(), float(m.group(2).replace(",", "")), m.group(3), re.sub(r"<[^>]+>", "", m.group(4))
        pct = float(re.sub(r"[^\d.\-]", "", chg) or 0)
        if "down" in cls and pct > 0:
            pct = -pct
        ticker.setdefault(sym, {"price": price, "pct": pct})
    report = re.search(r"Daily Market Report\s*</?[^>]*>?\s*(\d{1,2} \w{3} \d{4})", re.sub(r"<[^>]+>", " ", raw))
    return {"indices": list(idx.values()), "stats": stats, "ticker": ticker, "report_date": report.group(1) if report else None}


def watch(http: Http) -> dict:
    """Market watch (all equities): DSE's 15-minute-delayed view of the current session for every security
    (last/reference price, previous close, % change, volume, high, low) and its market capitalisation."""
    d = http.get(SITE + "/all-equities").replace('\\"', '"')
    return {o["symbol"]: o for o in (_json_after(d, '"quotes":[') or []) if o.get("symbol")}


def listed_bonds(http: Http) -> dict:
    gov = http.get(SITE + "/investors/products/government-bonds").replace('\\"', '"')
    rows = _json_after(gov, '"rows":[') or []
    g = []
    for r in rows:
        c = r.get("cells") or []
        if len(c) >= 9:
            g.append({"code": c[0], "name": c[1], "isin": c[2], "issue": c[3], "maturity": r.get("maturity") or c[4],
                      "c": float(str(c[5]).replace(",", "") or 0), "freq": c[6], "amount": float(str(c[7]).replace(",", "") or 0),
                      "term": r.get("term"), "matured": bool(r.get("matured")), "special": bool(r.get("special"))})
    fi = http.get(SITE + "/investors/products/fixed-income").replace('\\"', '"')
    corp = []
    for b in _json_after(fi, '"bonds":[') or []:
        parts = [p.strip() for p in (b.get("code") or "").split("·")]
        cpn = re.search(r"([\d.]+)\s*%", b.get("name") or "")
        yrs = next((p for p in parts if "Year" in p), None)
        corp.append({"name": b.get("name"), "issuer": b.get("issuer"), "code": parts[0] if parts else None,
                     "cur": parts[1] if len(parts) > 1 else "TZS", "term": yrs, "maturity": parts[-1] if parts and re.match(r"\d{4}-", parts[-1]) else None,
                     "c": float(cpn.group(1)) if cpn else None, "green": bool(b.get("green"))})
    return {"government": g, "corporate": corp}
