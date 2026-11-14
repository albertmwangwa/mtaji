"""Turn raw source data into the clean JSON files the website reads.

Every return is computed here, once, so the site and any other consumer agree on the numbers."""
from __future__ import annotations

import bisect
import datetime as dt
import math

from .common import d, pct, r4

MONTH = 30.4375


# ---------------------------------------------------------------- helpers
def _shift(day: dt.date, years=0, months=0) -> dt.date:
    m = day.month - 1 + months + 12 * years
    y, m = day.year + m // 12, m % 12 + 1
    for dd in (day.day, 30, 29, 28):
        try:
            return dt.date(y, m, dd)
        except ValueError:
            continue
    raise ValueError(day)


def _on_or_before(dates: list[str], vals: list[float], target: dt.date):
    """Value on the last date <= target (None if the series starts later)."""
    i = bisect.bisect_right(dates, target.isoformat()) - 1
    return (vals[i], dates[i]) if i >= 0 else (None, None)


def _ann(total: float | None, days: float) -> float | None:
    if total is None or days <= 0 or total <= -1:
        return None
    return (1 + total) ** (365 / days) - 1


# ---------------------------------------------------------------- funds
def fund_returns(rows: list[list], dpu: float = 0.0) -> dict:
    """Returns over standard windows from a daily [date, nav, ...] series.
    With dpu (monthly payout per unit), total return = (NAV now + payouts received) / NAV then - 1."""
    dates = [r[0] for r in rows]
    navs = [r[1] for r in rows]
    asof = d(dates[-1])
    now = navs[-1]
    out = {}

    def win(key, start: dt.date, cagr_years: float | None = None):
        v, day = _on_or_before(dates, navs, start)
        if v is None or (start - d(day)).days > 7:     # no reading within a week of the window start
            return
        days = (asof - d(day)).days
        nav_only = now / v - 1
        total = (now + dpu * days / MONTH) / v - 1 if dpu else nav_only
        if cagr_years:
            out[key] = pct((1 + total) ** (1 / cagr_years) - 1)
            if dpu:
                out[key + "nav"] = pct((1 + nav_only) ** (1 / cagr_years) - 1)
        else:
            out[key] = pct(total)
            if dpu:
                out[key + "nav"] = pct(nav_only)
        return total, days

    win("m1", _shift(asof, months=-1))
    m3 = win("m3", _shift(asof, months=-3))
    if m3:
        out["m3a"] = pct(_ann(*m3))
    win("y1", _shift(asof, years=-1))
    win("y3", _shift(asof, years=-3), 3)
    win("y5", _shift(asof, years=-5), 5)
    ye = dt.date(asof.year - 1, 12, 31)
    ytd = win("ytd", ye)
    if ytd:
        out["ytda"] = pct(_ann(*ytd))
    return out


def build_funds(cfg: dict, utt_hist: dict, nv: list[dict], prev_hist: dict, asof_run: str):
    """-> (funds list, history dict, warnings)"""
    meta = cfg["funds"]
    warnings = []
    nvmap = {f["fund_id"]: f for f in nv or []}
    hist = {k: v for k, v in (prev_hist or {}).items()}
    funds = []

    # official UTT daily history replaces whatever we had
    for fid, rows in (utt_hist or {}).items():
        hist[fid] = {"src": "UTT AMIS official daily NAV", "rows": [[r[0], r[1], r[3], r[4]] for r in rows]}

    # other funds: append today's NAVView snapshot so history accumulates run by run
    for fid, f in nvmap.items():
        if fid.startswith("utt.") or not f.get("nav_per_unit") or not f.get("date"):
            continue
        h = hist.setdefault(fid, {"src": "NAVView TZ snapshots collected by this pipeline", "rows": []})
        if not h["rows"] or h["rows"][-1][0] < f["date"]:
            h["rows"].append([f["date"], r4(f["nav_per_unit"]), r4(f.get("repurchase_price") or f["nav_per_unit"]),
                              round(f["nav_total"]) if f.get("nav_total") else None])

    for fid, m in meta.items():
        src = nvmap.get(m.get("proxy") or fid, {})
        cur = (src.get("currency") or "TZS").upper()
        rec = {"id": fid, "name": m.get("name") or src.get("fund_name") or fid, "mgr": m.get("mgr") or "UTT AMIS",
               "mgrShort": src.get("fund_manager_short") or (m.get("mgr") or "UTT AMIS").split(" ")[0],
               "cat": m["cat"], "cur": cur, "type": src.get("type"), "risk": src.get("risk_level"),
               "fee": m.get("fee"), "min": m.get("min"), "liq": m.get("liq"), "desc": m.get("desc"),
               "link": src.get("fund_page_link") or src.get("manager_link"), "ret": {}}
        for k in ("dpu", "dist", "yld", "listed", "inc"):
            if m.get(k):
                rec[k] = m[k]
        if m.get("proxy"):
            rec["proxy"] = m["proxy"]

        h = hist.get(fid)
        if fid.startswith("utt.") and h and h["rows"]:
            last = (utt_hist or {}).get(fid, [None])[-1] if utt_hist else None
            r = h["rows"][-1]
            rec.update(nav=r[1], sale=last[2] if last else r[1], rep=r[2], aum=r[3], date=r[0], src="UTT AMIS")
            rec["ret"] = fund_returns(h["rows"], m.get("dpu") or 0)
        elif src.get("nav_per_unit"):
            nav = src["nav_per_unit"]
            rec.update(nav=r4(nav), sale=r4(src.get("sale_price") or nav), rep=r4(src.get("repurchase_price") or nav),
                       aum=src.get("nav_total"), date=src.get("date"), src="NAVView TZ")
            ret = {"m1": pct(src.get("ret_1m")), "m3": pct(src.get("ret_3m")), "ytd": pct(src.get("ret_ytd")), "y1": pct(src.get("ret_1y"))}
            if m.get("yld") or src.get("performance_basis") == "published_yield":
                ret = {"y1": pct(src.get("latest_effective_annual_yield"))}
                rec["yld"] = True
            if m.get("proxy"):
                rec.update(nav=1.0, sale=1.0, rep=1.0, aum=None)
            if ret.get("m3") is not None:
                ret["m3a"] = pct(_ann(ret["m3"] / 100, 91.3))
            if ret.get("ytd") is not None and rec["date"]:
                days = (d(rec["date"]) - dt.date(d(rec["date"]).year - 1, 12, 31)).days
                ret["ytda"] = pct(_ann(ret["ytd"] / 100, days))
            inc = m.get("inc")
            if inc and rec["date"]:
                days = (d(rec["date"]) - d(inc["from"])).days
                ret["inc"] = pct(nav / inc["p0"] - 1)
                ret["inca"] = pct(_ann(nav / inc["p0"] - 1, days))
            # once a year of our own snapshots exists, compute the 12M figure ourselves if the source lacks it
            if ret.get("y1") is None and h and len(h["rows"]) > 200 and not m.get("yld"):
                ret.update({k: v for k, v in fund_returns(h["rows"]).items() if k in ("y1", "y3") and v is not None})
            rec["ret"] = {k: v for k, v in ret.items() if v is not None}
            if m.get("listed") and src.get("closing_price"):
                rec["market"] = {"price": src["closing_price"], "date": src.get("closing_price_date"),
                                 "prem": pct(src["closing_price"] / nav - 1, 1)}
            if src.get("sparkline_1y"):
                rec["spark"] = [round(x, 2) for x in src["sparkline_1y"]]
        else:
            rec.update(nav=None, date=None, src=None)
        if rec.get("nav") and rec.get("date") and (d(asof_run) - d(rec["date"])).days > 10:
            warnings.append(f"{fid}: latest NAV is from {rec['date']}, more than 10 days old")
        funds.append(rec)

    # sanity: daily NAV jumps that look like data errors
    for fid, h in hist.items():
        rows = h["rows"][-260:]
        for a, b in zip(rows, rows[1:]):
            if a[1] and b[1] and abs(b[1] / a[1] - 1) > 0.25:
                warnings.append(f"{fid}: NAV moved {pct(b[1] / a[1] - 1, 1)}% between {a[0]} and {b[0]}; check the source")
    return funds, hist, warnings


# ---------------------------------------------------------------- DSE
def _adjust(rows, divs, splits):
    rows = [list(r) for r in rows]
    divs = [dict(x) for x in divs]
    for day, ratio in splits or []:
        for r in rows:
            if r[0] < day:
                for i in (1, 2, 3, 4):
                    r[i] = r[i] / ratio
        for x in divs:
            if (x.get("books") or x.get("payment") or "9999") < day:
                x["dps"] = round(x["dps"] / ratio, 4)
                x["note"] = f"adjusted for the 1-for-{ratio} split on {day}"
    return rows, divs


def _drop_spikes(rows, jump=0.55, window=3):
    """Remove short runs (<= window sessions) whose close is more than `jump` away from the price on both sides,
    when the prices either side agree within 25%. These are bad prints, not real moves."""
    keep, dropped, i = [], [], 0
    while i < len(rows):
        skip = 0
        if keep:
            before = keep[-1][4]
            for w in range(1, window + 1):
                if i + w >= len(rows):
                    break
                after = rows[i + w][4]
                if abs(after / before - 1) < 0.25 and all(abs(r[4] / before - 1) > jump for r in rows[i:i + w]):
                    skip = w
                    break
        if skip:
            dropped += rows[i:i + skip]
            i += skip
        else:
            keep.append(rows[i])
            i += 1
    return keep, dropped


def build_dse(cfg: dict, raw: dict, prev: dict | None):
    tickers, out, warnings = cfg["tickers"], {}, []
    prev_t = (prev or {}).get("tickers", {})
    asof = max((v["rows"][-1][0] for v in raw.values() if v.get("rows")), default=None)
    for t, meta in tickers.items():
        src = raw.get(t) or {}
        if not src.get("rows"):
            if t in prev_t:
                out[t] = prev_t[t]
                warnings.append(f"DSE {t}: fetch failed ({src.get('error', 'no rows')}); kept the previous data")
            continue
        scraped = src.get("divs", [])
        extra = [dict(x, src=x.get("src") or "manual") for x in meta.get("dividends_extra", [])
                 if not any(abs(y["dps"] - x["dps"]) < 1e-6 and (y.get("payment") or "")[:4] == (x.get("payment") or x.get("announced") or "")[:4] for y in scraped)]
        rows, divs = _adjust(src["rows"], scraped + extra, meta.get("splits"))
        divs.sort(key=lambda x: x.get("payment") or x.get("announced") or "", reverse=True)
        rows = [r for r in rows if r[4] > 0]
        rows, dropped = _drop_spikes(rows)
        for r in dropped:
            warnings.append(f"DSE {t}: ignored a bad print of {r[4]:g} on {r[0]} (it reversed within a few sessions)")
        dates, closes = [r[0] for r in rows], [r[4] for r in rows]
        last = rows[-1]
        day = d(last[0])

        def back(n):
            return closes[-1 - n] if len(closes) > n else None

        def at(target):
            v, _ = _on_or_before(dates, closes, target)
            return v

        chg = lambda a: pct(last[4] / a - 1) if a else None
        y5 = at(_shift(day, years=-5))
        year = [r for r in rows if r[0] > _shift(day, years=-1).isoformat()]
        traded = [r for r in year if r[5] > 0]
        # month-end closes, carried forward through months without trades; up to 10 years
        start = max(d(dates[0]).replace(day=1), _shift(day.replace(day=1), years=-10))
        last_in_month = {}
        for r in rows:
            last_in_month[r[0][:7]] = r[4]
        months, cur, prevc = [], start, None
        while cur <= day:
            key = cur.isoformat()[:7]
            prevc = last_in_month.get(key, prevc)
            months.append(round(prevc, 2) if prevc else None)
            cur = _shift(cur, months=1)
        # dividends: regular annual figure = override, else trailing 12 months by payment date, else latest year paid
        ttm = sum(x["dps"] for x in divs if x.get("payment") and x["payment"] > _shift(day, years=-1).isoformat())
        by_year = {}
        for x in divs:
            yk = (x.get("payment") or x.get("announced") or "")[:4]
            if yk:
                by_year[yk] = round(by_year.get(yk, 0) + x["dps"], 4)
        dv = {"ttm": round(ttm, 4), "years": sorted(by_year.items(), reverse=True), "list": divs[:12]}
        if meta.get("dividend_override"):
            dv.update(regular=meta["dividend_override"]["dps"], note=meta["dividend_override"].get("note"))
        elif ttm:
            dv["regular"] = round(ttm, 4)
        elif by_year:
            yk, amt = sorted(by_year.items())[-1]
            dv.update(regular=amt, stale=yk)
        out[t] = {"name": meta["name"], "sec": meta["sec"], "x": bool(meta.get("x")),
                  "close": last[4], "date": last[0], "open": last[1], "high": last[2], "low": last[3],
                  "vol": last[5], "turn": last[6],
                  "chg": {"d1": chg(back(1)), "w1": chg(back(5)), "m1": chg(back(21)), "ytd": chg(at(dt.date(day.year - 1, 12, 31))),
                          "y1": chg(at(_shift(day, years=-1))),
                          "y5a": pct((last[4] / y5) ** (1 / 5) - 1) if y5 and d(dates[0]) <= _shift(day, years=-5) else None},
                  "liq": {"sessions": len(year), "traded": len(traded),
                          "avgTurn": round(sum(r[6] for r in year) / max(1, len(year)))},
                  "hi52": max(r[2] for r in year) if year else None, "lo52": min(r[3] for r in year if r[3] > 0) if year else None,
                  "monthly": {"m0": start.isoformat()[:7], "c": months},
                  "daily": [[r[0], round(r[4], 2), int(r[5])] for r in rows[-400:]],
                  "div": dv}
        if meta.get("splits"):
            out[t]["splits"] = meta["splits"]
        for a, b in zip(rows[-500:], rows[-499:]):
            if b[4] / a[4] > 1.6 or b[4] / a[4] < 0.55:
                warnings.append(f"DSE {t}: close moved from {a[4]:g} to {b[4]:g} on {b[0]}; a split or data error? Add it to config/dse.json if it is a split.")
    total_turn = sum(v["turn"] for v in out.values() if v.get("date") == asof)
    up = sum(1 for v in out.values() if (v["chg"].get("d1") or 0) > 0 and v.get("date") == asof)
    down = sum(1 for v in out.values() if (v["chg"].get("d1") or 0) < 0 and v.get("date") == asof)
    return {"asof": asof, "market": {"turnover": round(total_turn), "up": up, "down": down, "count": len(out)}, "tickers": out}, warnings
