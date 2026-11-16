"""Bank of Tanzania (bot.go.tz): Treasury bill and bond auction results, and daily exchange rates.

The auction list pages are plain HTML; each auction's result comes from the JSON endpoints the site's own
"View" buttons call (Scripts/custom2.js): POST Tbills/getTbillsDetails {au_no} and TBonds/AuctionSummaries {au_no, au_days}."""
from __future__ import annotations

import datetime as dt
import html
import json
import re

from ..common import Http

BASE = "https://www.bot.go.tz/"
HDR = {"X-Requested-With": "XMLHttpRequest"}


def _date(s: str) -> str | None:
    s = s.strip()
    for f in ("%d-%b-%Y", "%m/%d/%Y", "%d/%m/%Y", "%B %d, %Y", "%d-%b-%y"):
        try:
            return dt.datetime.strptime(s.title() if "%b" in f or "%B" in f else s, f).date().isoformat()
        except ValueError:
            continue
    return None


def _num(v):
    if v is None:
        return None
    s = str(v).replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _rows(page: str, cls: str) -> list[tuple[str, str, str]]:
    """(value attribute, title, date) for each auction listed on a BoT results page."""
    out = []
    for tr in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        btn = re.search(r'id="showSummaryDetails" value="([^"]+)"', tr)
        tds = [" ".join(html.unescape(re.sub(r"<[^>]+>", " ", x)).split()) for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if btn and len(tds) >= 3:
            out.append((btn.group(1), tds[1], tds[2]))
    return out


def bills(http: Http, n: int = 26) -> list[dict]:
    page = http.get(BASE + "TBills?lang=en")
    out = []
    for no, title, day in _rows(page, "tbill")[:n]:
        j = json.loads(http.request(BASE + "Tbills/getTbillsDetails", data={"au_no": no}, headers=HDR))
        T = j.get("TbillData") or []
        if not T:
            continue
        tenors = [int(re.sub(r"\D", "", h)) for h in T[0][1:] if re.search(r"\d", h)]
        lab = {r[0].strip().lower(): r[1:] for r in T[1:]}

        def get(key):
            for k, v in lab.items():
                if k.startswith(key):
                    return v
            return [None] * len(tenors)
        rec = {"no": int(no), "date": _date(day), "tenors": {}}
        for i, d in enumerate(tenors):
            rec["tenors"][str(d)] = {
                "y": _num(get("weighted average yield")[i]), "price": _num(get("weighted average price")[i]),
                "offered": _num(get("amount offered")[i]), "tendered": _num(get("amount tendered")[i]),
                "accepted": _num(get("successful bids tzs")[i]), "bids": _num(get("number of bids")[i]),
                "maturity": _date(str(get("maturity date")[i] or ""))}
        out.append(rec)
    return out


def bonds(http: Http, n: int = 36) -> list[dict]:
    page = http.get(BASE + "TBonds?lang=en")
    out = []
    for val, title, day in _rows(page, "tbond")[:n]:
        no, _, days = val.partition("_")
        j = json.loads(http.request(BASE + "TBonds/AuctionSummaries", data={"au_no": no, "au_days": days}, headers=HDR))
        if j.get("message") != "SUCCESS":
            continue
        items = {x["itemDesc"].strip().upper(): x for x in j.get("tbondSummary", [])}

        def v(prefix, non=False):
            for k, x in items.items():
                if k.startswith(prefix):
                    return _num(x["itemValueNon" if non else "itemValue"])
            return None
        tenor = re.search(r"(\d+)\s*-?\s*YEAR", title.upper())
        cpn = re.search(r"([\d.]+)\s*%", title)
        red = next((x["itemValue"] for k, x in items.items() if k.startswith("REDEMPTION")), None)
        out.append({"no": int(no), "issue": int(days), "date": _date(j.get("BondDate") or day) or _date(day), "title": j.get("bondTitle") or title,
                    "tenor": int(tenor.group(1)) if tenor else None, "c": float(cpn.group(1)) if cpn else None, "isin": j.get("ISIN"),
                    "ytm": v("WEIGHTED AVERAGE YIELD"), "price": v("WEIGHTED AVERAGE PRICE"), "offered": v("AMOUNT OFFERED"),
                    "tendered": v("TOTAL TENDERED"), "accepted": v("SUCCESSFUL BIDS"), "bids": v("NUMBER OF BIDS RECEIVED"),
                    "redemption": _date(red) if red else None})
    return out


def fx(http: Http) -> dict:
    page = http.get(BASE + "ExchangeRate/excRates?lang=en")
    rates, day = {}, None
    for tr in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        tds = [" ".join(html.unescape(re.sub(r"<[^>]+>", " ", x)).split()) for x in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
        if len(tds) >= 6 and re.fullmatch(r"[A-Z]{3}", tds[1]) and _num(tds[4]):
            rates[tds[1]] = {"buy": _num(tds[2]), "sell": _num(tds[3]), "mean": _num(tds[4])}
            day = day or _date(tds[5])
    if "USD" not in rates:
        raise RuntimeError("BoT: USD rate not found on the exchange rate page")
    return {"date": day, "rates": rates}
