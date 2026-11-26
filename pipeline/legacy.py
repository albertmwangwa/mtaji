"""Keep the classic single-file calculator (legacy/Mtaji Investment Calculators.html) in step with data/.

The classic page carries its own copies of fund NAVs, T-bill and bond yields, DSE prices and the dates they
refer to. This rewrites those values in place from data/*.json after every full pipeline run. Text written
by hand (fund descriptions, fees, minimums, dividend notes) is left alone. Any pattern that no longer matches
is reported as a warning instead of failing the run.
"""
from __future__ import annotations

import datetime as dt
import json
import re

from .common import DATA, ROOT, read_json

PAGE = ROOT / "legacy" / "Mtaji Investment Calculators.html"

# classic-page fund key -> platform fund id
FUND_IDS = {
    "umoja": "utt.umoja", "wekeza": "utt.wekeza", "watoto": "utt.watoto", "jikimu": "utt.jikimu", "liquid": "utt.liquid",
    "bond": "utt.bond", "faida": "whi.faida", "icash": "itrust.iCash", "isave": "itrust.iSave", "iincome": "itrust.iIncome",
    "imaan": "itrust.Imaan", "igrowth": "itrust.iGrowth", "idollar": "itrust.iDollar", "ieaclc": "itrust.iEACLC",
    "mwekeza": "sanlam.mwekeza", "inuka": "orbit.inuka", "inukadz": "orbit.inukaDozen", "pesa": "sanlam.pesammf",
    "sanusd": "sanlam.usdFixedIncome", "imara": "tsl.imara", "kesho": "tsl.keshotulivu", "vbond": "vertex.bond",
    "vetf": "vertex.etf", "timiza": "zansec.timiza", "timizap": "zansec.timiza-plus", "zanetf": "zansec.timiza-etf",
    "ziada": "apef.ziada", "ziadai": "apef.ziadaInsured",
}
UTT_KEYS = ["umoja", "wekeza", "watoto", "jikimu", "liquid", "bond"]
ETF_OF = {"ieaclc": "IEACLC-ETF", "vetf": "VERTEX-ETF", "zanetf": "ZAN TIMIZA ETF"}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def dstr(iso: str, year=True) -> str:
    d = dt.date.fromisoformat(iso[:10])
    return f"{d.day} {MON[d.month - 1]}" + (f" {d.year}" if year else "")


def _num(v, nd):
    return "null" if v is None else f"{v:.{nd}f}"


class Page:
    def __init__(self, text):
        self.s, self.warn = text, []

    def sub(self, pattern, repl, count=1, flags=0, what=""):
        new, n = re.subn(pattern, repl, self.s, count=count, flags=flags)
        if n == 0:
            self.warn.append(f"classic calculator: could not update {what or pattern[:60]}")
        self.s = new
        return n

    def block(self, start, end, body, what):
        """Replace the text between `start` and the next `end` (both kept)."""
        i = self.s.find(start)
        j = self.s.find(end, i + len(start)) if i >= 0 else -1
        if i < 0 or j < 0:
            self.warn.append(f"classic calculator: block {what} not found")
            return
        self.s = self.s[:i + len(start)] + body + self.s[j:]


def _field(line, key, value):
    """Set key:value inside one object-literal line (only if the key is there)."""
    return re.sub(r"(\b" + key + r":)\s*(?:'[^']*'|[-\w.+]+)", lambda m: m.group(1) + value, line, count=1)


def update(log=print) -> list[str]:
    funds = {f["id"]: f for f in (read_json(DATA / "funds.json", {}) or {}).get("funds", [])}
    hist = read_json(DATA / "funds-history.json", {}) or {}
    dse = read_json(DATA / "dse.json", {}) or {}
    tre = read_json(DATA / "treasury.json", {}) or {}
    if not (funds and dse and tre and PAGE.exists()):
        return ["classic calculator: data files missing, not updated"]
    p = Page(PAGE.read_text(encoding="utf8"))

    # ---------------- unit trusts ----------------
    lines = p.s.split("\n")
    other_dates = []
    for i, ln in enumerate(lines):
        m = re.match(r"\s+(\w+):\s*\{name:", ln)
        if not m or m.group(1) not in FUND_IDS:
            continue
        k, f = m.group(1), funds.get(FUND_IDS[m.group(1)])
        if not f or not f.get("nav"):
            continue
        r = f.get("ret") or {}
        ln = _field(ln, "nav", _num(f["nav"], 4))
        if "rep:" in ln and f.get("rep"):
            ln = _field(ln, "rep", _num(f["rep"], 4))
        if f.get("aum"):
            ln = _field(ln, "aum", str(round(f["aum"])))
        if "m1:" in ln and "yld:true" not in ln:   # the page adds Bond Fund payouts itself, so it wants the NAV-only change
            ln = _field(ln, "m1", _num(r.get("m1nav", r.get("m1")) if "dpu:" in ln else r.get("m1"), 2))
            ln = _field(ln, "m3", _num(r.get("m3nav", r.get("m3")) if "dpu:" in ln else r.get("m3"), 2))
        if re.search(r"\by1:", ln):
            ln = _field(ln, "y1", _num(r.get("y1"), 2))
        ln = _field(ln, "date", f"'{f['date']}'")
        if k in ETF_OF:
            e = (dse.get("market") or {}).get("etfs", {}).get(ETF_OF[k])
            if e and e.get("price") and e.get("nav"):
                prem = (e["price"] / e["nav"] - 1) * 100
                word = "discount" if prem < 0 else "premium"
                ln = re.sub(r"NAV [\d,.]+ on \d+ \w+ \d{4}; the DSE price was TZS [\d,.]+ on \d+ \w+, a \d+% (discount|premium)",
                            f"NAV {f['nav']:,.2f} on {dstr(f['date'])}; the DSE price was TZS {e['price']:,.0f} on {dstr(dse['asof'], False)}, a {abs(prem):.0f}% {word}", ln)
                ln = re.sub(r"Trades on the DSE at TZS [\d,.]+, a \d+% (discount|premium) to its NAV of \d[\d,]*(?:\.\d+)?",
                            f"Trades on the DSE at TZS {e['price']:,.2f}, a {abs(prem):.0f}% {word} to its NAV of {f['nav']:,.2f}", ln)
                ln = re.sub(r"Trades on the DSE at TZS [\d,.]+, a \d+% (discount|premium) to NAV",
                            f"Trades on the DSE at TZS {e['price']:,.2f}, a {abs(prem):.0f}% {word} to NAV", ln)
        if k not in UTT_KEYS:
            other_dates.append(f["date"])
        lines[i] = ln
    p.s = "\n".join(lines)

    # UTT AMIS official NAV history (weekly from mid-2023, plus the dates the page looks up exactly)
    now = max(hist[FUND_IDS[k]]["rows"][-1][0] for k in UTT_KEYS if FUND_IDS[k] in hist)
    nd = dt.date.fromisoformat(now)
    y1s, y3s = nd.replace(year=nd.year - 1).isoformat(), nd.replace(year=nd.year - 3).isoformat()
    ytd_base = None
    series = {}
    for k in UTT_KEYS:
        rows = hist.get(FUND_IDS[k], {}).get("rows") or []
        rows = [r for r in rows if r[0] >= "2023-06-30" and r[0] <= now]
        if not rows:
            continue
        yb = max((r[0] for r in rows if r[0] < f"{nd.year}-01-01"), default=None)
        ytd_base = ytd_base or yb
        keep, last_wk = [], None
        for r in rows:
            wk = dt.date.fromisoformat(r[0]).isocalendar()[:2]
            if wk != last_wk or r[0] in (yb, now):
                keep.append(r); last_wk = wk
            elif r[0] == yb:
                keep.append(r)
        keep = sorted({r[0]: r for r in keep + [x for x in rows if x[0] in (yb, now)]}.values())
        series[k] = [[r[0], round(r[1], 4), "o"] for r in keep]
    rep = read_reported(p.s)
    for k, pts in series.items():   # leave out readings on the same day as a hand-entered report
        series[k] = [x for x in pts if x[0] not in rep.get(k, set())]
    p.sub(r"const SERIES = \{.*?\};\n", lambda m: "const SERIES = " + json.dumps(series) + ";\n", flags=re.S, what="SERIES")
    p.sub(r"const Y3_START = '[\d-]+', Y1_START = '[\d-]+', NOW = '[\d-]+';", f"const Y3_START = '{y3s}', Y1_START = '{y1s}', NOW = '{now}';", what="NOW")
    old_ytd = re.search(r"navOn\(k,'(\d{4}-\d{2}-\d{2})'\)", p.s)
    if old_ytd and ytd_base and old_ytd.group(1) != ytd_base:
        p.s = p.s.replace(f"'{old_ytd.group(1)}'", f"'{ytd_base}'").replace(f"from {dstr(old_ytd.group(1))}", f"from {dstr(ytd_base)}")

    o_lo, o_hi = (min(other_dates), max(other_dates)) if other_dates else (now, now)
    span = lambda a, b: dstr(a, False) + "–" + dstr(b) if a != b else dstr(a)
    ranged = lambda a, b: (f"{dt.date.fromisoformat(a).day}–{dstr(b, False)}" if a[:7] == b[:7] else f"{dstr(a, False)}–{dstr(b, False)}") if a != b else dstr(a, False)
    bills_dates = [v["date"] for v in tre.get("bills", {}).values() if v.get("date")] + [v["date"] for v in tre.get("bonds", {}).values() if v.get("date")]
    ylo, yhi = min(bills_dates), max(bills_dates)
    yrng = (MON[int(ylo[5:7]) - 1] + "–" + MON[int(yhi[5:7]) - 1] + " " + yhi[:4]) if ylo[:7] != yhi[:7] else MON[int(yhi[5:7]) - 1] + " " + yhi[:4]
    p.sub(r'<div class="asof">NAVs [^<]*</div>', f'<div class="asof">NAVs {dstr(now)} · Yields {yrng}</div>', what="header date")
    p.sub(r'(Latest NAV date</div><div class="v">)[^<]*(</div><div class="s">UTT AMIS official · others )[^<]*(</div>)',
          lambda m: m.group(1) + dstr(now) + m.group(2) + ranged(o_lo, o_hi) + m.group(3), what="NAV date KPI")
    p.sub(r"(Dots are dated NAV readings from 30 Jun 2023 to )\d+ \w+ \d{4}", lambda m: m.group(1) + dstr(now), what="series note")
    p.sub(r"All periods end \d+ \w+ \d{4} \(1M and 3M to [^)]*\)", f"All periods end {dstr(now)}", what="period note")
    p.sub(r"1Y from \d+ \w+ \d{4} and 3Y CAGR from \d+ \w+ \d{4}", f"1Y from {dstr(y1s)} and 3Y CAGR from {dstr(y3s)}", what="period starts")
    p.sub(r"3-year CAGR \(\w+ \d{4} – \w+ \d{4}\)", f"3-year CAGR ({MON[int(y3s[5:7]) - 1]} {y3s[:4]} – {MON[nd.month - 1]} {nd.year})", what="CAGR label")
    p.sub(r"valued at the \d+ \w+ \d{4} price", f"valued at the {dstr(now)} price", what="what-if note")
    p.sub(r"'<div><small>Value \d+ \w+ \d{4}</small>", f"'<div><small>Value {dstr(now)}</small>", what="what-if value")
    p.sub(r"official NAVs for \d+ \w+ \d{4}", f"official NAVs for {dstr(now)}", what="data note UTT")
    p.sub(r"as listed by NAVView TZ for [^.]*?\d{4}\.", f"as listed by NAVView TZ for {ranged(o_lo, o_hi)} {o_hi[:4]}.", what="data note NAVView")
    p.sub(r"IEACLC-ETF uses its NAV for \d+ \w+ \d{4}", f"IEACLC-ETF uses its NAV for {dstr(funds.get('itrust.iEACLC', {}).get('date') or now)}", what="data note IEACLC")
    p.sub(r"(NAV per unit, 1M / 3M / 12M NAV change, size, fee, minimum and liquidity as listed by NAVView TZ, )[^.]*\.",
          lambda m: m.group(1) + ranged(o_lo, o_hi) + " " + o_hi[:4] + ".", what="fund comment")

    # ---------------- T-bills and T-bonds ----------------
    def src(v, bond=False):
        if not v.get("date") or v.get("stale"):
            return "false"
        return f"'BOT auction {dstr(v['date'])} ({'bond no.' if bond else 'no.'} {v['no']})'"
    b = tre["bills"]
    p.sub(r"const TBILL = \{.*?\};", "const TBILL = { " + ", ".join(f"{t}:{{y:{b[t]['y']:.4f},src:{src(b[t])}}}" for t in ("35", "91", "182", "364") if t in b) + " };", flags=re.S, what="TBILL")
    bd = tre["bonds"]
    items = [f"{t}:{{c:{bd[t]['c']:.2f},y:{bd[t]['y']:.4f},src:{src(bd[t], True)}}}" for t in ("2", "5", "7", "10", "15", "20", "25") if t in bd]
    p.sub(r"const TBOND = \{.*?\n\};", "const TBOND = {\n  " + ",\n  ".join(", ".join(items[i:i + 2]) for i in range(0, len(items), 2)) + "\n};", flags=re.S, what="TBOND")
    p.sub(r"const TB_ASOF = '[\d-]+';", f"const TB_ASOF = '{yhi}';", what="TB_ASOF")
    # the forms' starting values are those of the tenor each form opens on
    bt = re.search(r'name="b-ten" id="b-ten-(\d+)" value="\d+" checked', p.s)
    if bt and bt.group(1) in b:
        y = b[bt.group(1)]["y"]
        p.sub(r'(<input id="b-yld"[^>]*value=")[\d.]+(")', lambda m: f"{m.group(1)}{y:.4f}{m.group(2)}", what="bill yield default")
        p.sub(r'(<input type="range" id="b-yld-r"[^>]*value=")[\d.]+(")', lambda m: f"{m.group(1)}{y:.2f}{m.group(2)}", what="bill slider default")
    tt = re.search(r'<option value="(\d+)" selected>\d+ years</option>', p.s)
    if tt and tt.group(1) in bd:
        c, y = bd[tt.group(1)]["c"], bd[tt.group(1)]["y"]
        p.sub(r'(<input id="t-cpn"[^>]*value=")[\d.]+(")', lambda m: f"{m.group(1)}{c:.2f}{m.group(2)}", what="bond coupon default")
        p.sub(r'(<input id="t-ytm"[^>]*value=")[\d.]+(")', lambda m: f"{m.group(1)}{y:.4f}{m.group(2)}", what="bond yield default")
        p.sub(r'(<input type="range" id="t-ytm-r"[^>]*value=")[\d.]+(")', lambda m: f"{m.group(1)}{y:.2f}{m.group(2)}", what="bond slider default")

    # ---------------- DSE ----------------
    T, asof = dse["tickers"], dse["asof"]
    lines = p.s.split("\n")
    for i, ln in enumerate(lines):
        m = re.match(r"\s+([A-Z][A-Z-]*):\s*\{n:'", ln)
        if not m or m.group(1) not in T:
            continue
        s = T[m.group(1)]
        daily = s.get("daily") or []
        w1 = daily[-6][1] if len(daily) >= 6 else s["close"]
        ln = _field(ln, "p", f"{s['close']:g}")
        ln = _field(ln, "w1", f"{w1:g}")
        ln = _field(ln, "m1", _num(s["chg"].get("m1") or 0, 2))
        ln = _field(ln, "t", f"{(s.get('turn') or 0) / 1e6:.2f}e6" if s.get("date") == asof and s.get("turn") else "0")
        lines[i] = ln
    p.s = "\n".join(lines)
    n_months = 61
    px, m0 = {}, None
    for t, s in T.items():
        mo = s.get("monthly") or {}
        c = mo.get("c") or []
        if not c:
            continue
        start = len(c) - n_months
        y, mth = map(int, mo["m0"].split("-"))
        mm = y * 12 + (mth - 1) + max(0, start)
        m0 = f"{mm // 12}-{mm % 12 + 1:02d}"
        px[t] = [None if v is None else round(v, 2) for v in c[max(0, start):]]
    p.sub(r"const DSE_PX = \{.*?\};", "const DSE_PX = " + json.dumps(px, separators=(",", ":")) + ";", flags=re.S, what="DSE_PX")
    if m0:
        p.sub(r"const DSE_M0 = '[\d-]+';", f"const DSE_M0 = '{m0}';", what="DSE_M0")
        p.sub(r"y0 = \d{4}, m0 = \d+;   // \w+ \d{4} = month index \d+",
              f"y0 = {m0[:4]}, m0 = {int(m0[5:]) - 1};   // {MON[int(m0[5:]) - 1]} {m0[:4]} = month index {int(m0[5:]) - 1}", what="DSE chart start")
        p.sub(r"Month-end DSE closes, \w+ \d{4} – \d+ \w+ \d{4}", f"Month-end DSE closes, {MON[int(m0[5:]) - 1]} {m0[:4]} – {dstr(asof)}", what="DSE_PX comment")
    liq = {t: [s["liq"]["traded"], s["liq"]["avgTurn"]] for t, s in T.items()}
    p.sub(r"const DSE_LIQ = \{.*?\};", "const DSE_LIQ = " + json.dumps(liq, separators=(",", ":")) + ";", flags=re.S, what="DSE_LIQ")
    ad = dt.date.fromisoformat(asof)
    p.sub(r"const now = new Date\(\d{4}, \d+, \d+\)\.getTime\(\), yr = 365\.25\*864e5;", f"const now = new Date({ad.year}, {ad.month - 1}, {ad.day}).getTime(), yr = 365.25*864e5;", what="share forecast date")
    p.sub(r"' on \d+ \w+ \d{4}' \+ \(st\.t \?", f"' on {dstr(asof)}' + (st.t ?", what="share close note")
    p.sub(r"\+\(2026 \+ y\)\+|\+\(\d{4} \+ y\)\+", f"+({ad.year} + y)+", what="forecast years")
    wk = next((d[0] for d in reversed(T.get("CRDB", {}).get("daily") or []) if d[0] <= (ad - dt.timedelta(days=7)).isoformat()), None)
    p.sub(r"Closing prices for \d+ \w+ \d{4} from the DSE\. 1W compares with the \d+ \w+ close",
          f"Closing prices for {dstr(asof)} from the DSE. 1W compares with the {dstr(wk or asof, False)} close", what="DSE table note")
    p.sub(r"DSE share prices are the official closes for \d+ \w+ \d{4} \(dse\.co\.tz\), with \d+ \w+ closes from the DSE weekly report and 1-month changes from Kanza Capital Partners' DSE record",
          f"DSE share prices are the official closes for {dstr(asof)} (dse.co.tz), with 1-week and 1-month changes from the DSE trading history", what="data note DSE")
    mk = dse.get("market") or {}
    ix = {i["name"]: i for i in mk.get("indices") or []}
    if "DSEI" in ix:
        i = ix["DSEI"]
        ser = i.get("series") or []
        hi = max(ser, key=lambda x: x[1]) if ser else None
        since = (i["close"] / ser[0][1] - 1) * 100 if ser else 0
        p.sub(r'(All Share Index \(DSEI\)</div><div class="v">)[^<]*(</div><div class="s">)[^<]*(</div>)',
              lambda m: f"{m.group(1)}{i['close']:,.2f}{m.group(2)}{'−' if (i.get('pct') or 0) < 0 else '+'}{abs(i.get('pct') or 0):.2f}% on the day · {'+' if since >= 0 else '−'}{abs(since):.1f}% since {dstr(ser[0][0])}{m.group(3)}", what="DSEI KPI")
        if hi:
            below = (1 - i["close"] / hi[1]) * 100
            p.sub(r'(Latest close</div><div class="v">)[^<]*(</div><div class="s">)[^<]*(</div>)',
                  lambda m: f"{m.group(1)}{dstr(asof)}{m.group(2)}{'DSEI at its 12-month high' if below < 0.05 else f'DSEI {below:.1f}% below its {dstr(hi[0], False)} high'}{m.group(3)}", what="latest close KPI")
    if "TSI" in ix:
        i = ix["TSI"]
        p.sub(r'(Tanzania Share Index \(TSI\)</div><div class="v">)[^<]*(</div><div class="s">)[^·<]*',
              lambda m: f"{m.group(1)}{i['close']:,.2f}{m.group(2)}{'−' if (i.get('pct') or 0) < 0 else '+'}{abs(i.get('pct') or 0):.2f}% ", what="TSI KPI")
    if mk.get("cap"):
        p.sub(r'(Market value</div><div class="v">)TZS [\d.]+T(</div><div class="s">)[^<]*',
              lambda m: f"{m.group(1)}TZS {mk['cap'] / 1e12:.2f}T{m.group(2)}{mk.get('listed') or len(T)} listed companies", what="market value KPI")

    PAGE.write_text(p.s, encoding="utf8")
    log(f"classic calculator: NAVs {now}, DSE {asof}, BoT {yhi}" + (f" ({len(p.warn)} warnings)" if p.warn else ""))
    return p.warn


def read_reported(s: str) -> dict:
    """Dates of the hand-entered half-year NAVs in REPORTED, per fund."""
    m = re.search(r"const REPORTED = \{(.*?)\n\};", s, re.S)
    out = {}
    for ln in (m.group(1) if m else "").split("\n"):
        k = re.match(r"\s*(\w+):\s*\[", ln)
        if k:
            out[k.group(1)] = set(re.findall(r"'(\d{4}-\d{2}-\d{2})'", ln))
    return out
