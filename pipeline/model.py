"""DSE price model, rebuilt from the full price history on every pipeline run.

For each share: a central price and a likely range (meant to hold 8 times in 10) for the next session, a week,
a month, 3 months, a year, and 2, 3 and 5 years, plus how often such ranges actually held in tests.

Method
- Drift (expected price growth): the share's own long-run growth (up to 10 years) shrunk towards the DSE-wide
  median, more strongly when its history is short or volatile (empirical Bayes). One great run is not assumed to repeat.
- Range: the spread of the share's own price moves over the same horizon in the last 5 years (empirical
  quantiles, so fat tails and days without trades are kept as they really happened).
- Calibration: the width is tuned so that, across all shares, ranges held 80% of the time over a calibration
  window. Validation uses 2019-2022 to tune and 2023 onwards to test (the test never touches the tuning data);
  the live model is re-tuned on 2023 onwards at every run.
- Next session: the range is kept inside the DSE price cap (Rule 212: 15%, 5% or 2% of the previous close).
"""
import math
import datetime as dt
from statistics import median

H = {"1d": 1, "1w": 5, "1m": 21, "3m": 63, "1y": 252}
W_RECENT = {"1d": 0.7, "1w": 0.6, "1m": 0.5, "3m": 0.4, "1y": 0.25}   # weight on recent volatility per horizon
YEARS = (2, 3, 5)
Q = (0.10, 0.50, 0.90)
CAL = ("2019-01-01", "2023-01-01")     # validation: tune here ...
TEST_FROM = "2023-01-01"               # ... and test from here (also the live tuning window)
LAM = 0.5 ** (1 / 63)
MU_CLAMP = 0.35
TAU_FLOOR = 0.06
STEP = 5                               # an origin every 5 sessions


def _q(xs, p):
    xs = sorted(xs)
    if not xs:
        return 0.0
    k = (len(xs) - 1) * p
    f = math.floor(k)
    return xs[f] + (xs[min(f + 1, len(xs) - 1)] - xs[f]) * (k - f)


def _shift_iso(day, years):
    d = dt.date.fromisoformat(day)
    try:
        return d.replace(year=d.year + years).isoformat()
    except ValueError:
        return d.replace(year=d.year + years, day=28).isoformat()


def cap_for(mcap, price):
    """DSE Rule 212 price cap from market capitalisation and shares in issue."""
    if not mcap or not price or mcap < 1e12:
        return 0.15
    return 0.05 if mcap / price > 2e9 else 0.02


class Series:
    def __init__(self, rows):
        self.d = [r[0] for r in rows]
        self.c = [r[4] for r in rows]
        self.v = [r[5] for r in rows]
        self.lc = [math.log(x) for x in self.c]
        n = len(self.c)
        r = [0.0] + [self.lc[i] - self.lc[i - 1] for i in range(1, n)]
        self.ew, self.lr = [0.0] * n, [0.0] * n     # EWMA variance; expanding long-run variance (from the first trade)
        var, s2, cnt = None, 0.0, 0
        first = next((i for i, x in enumerate(self.v) if x > 0), 0)
        for i in range(n):
            x2 = r[i] * r[i]
            var = x2 if var is None else LAM * var + (1 - LAM) * x2
            self.ew[i] = var
            if i >= first:
                s2 += x2; cnt += 1
            self.lr[i] = s2 / cnt if cnt else x2
        self.first = first

    def sig(self, i, k):
        w = W_RECENT[k]
        return math.sqrt(max(0.003 ** 2, w * self.ew[i] + (1 - w) * self.lr[i]))

    def idx_before(self, day):
        lo, hi = 0, len(self.d)
        while lo < hi:
            m = (lo + hi) // 2
            if self.d[m] < day:
                lo = m + 1
            else:
                hi = m
        return lo - 1

    def own_drift(self, i, years=10):
        j = max(self.first, self.idx_before(_shift_iso(self.d[i], -years)), 0)
        span = (dt.date.fromisoformat(self.d[i]) - dt.date.fromisoformat(self.d[j])).days / 365.25
        if span < 1.5:
            return None, span
        return (self.lc[i] - self.lc[j]) / span, span

    def spreads(self, i, k, window=1260):
        """Low/mid/high log moves over horizon k from the last `window` sessions known at index i, relative to
        their median: (q10 - q50, 0, q90 - q50). None if there are too few."""
        h = H[k]
        if k == "1y":   # too few independent years for empirical quantiles: lognormal on the blended volatility
            sd = self.sig(i, k) * math.sqrt(h)
            return (-1.2816 * sd, 0.0, 1.2816 * sd) if i - self.first >= 250 else None
        a = max(self.first, i - window)
        mv = [self.lc[t + h] - self.lc[t] for t in range(a, i - h + 1)]
        if len(mv) < 120:
            return None
        q10, q50, q90 = (_q(mv, p) for p in Q)
        return (q10 - q50, 0.0, q90 - q50)


def _prior(S, at_day=None):
    mus, noise = [], []
    for s in S.values():
        i = len(s.d) - 1 if at_day is None else s.idx_before(at_day)
        if i < 300:
            continue
        mu, span = s.own_drift(i)
        if mu is None or span < 4:
            continue
        mus.append(mu); noise.append(s.sig(i, "1y") ** 2 * 252 / span)
    if len(mus) < 4:
        return 0.05, TAU_FLOOR ** 2
    m = median(mus)
    var = sum((x - m) ** 2 for x in mus) / (len(mus) - 1)
    return m, max(TAU_FLOOR ** 2, var - sum(noise) / len(noise))


def _posterior(s, i, prior):
    m, tau2 = prior
    mu, span = s.own_drift(i)
    if mu is None:
        return m, tau2, 0.0, None
    se2 = s.sig(i, "1y") ** 2 * 252 / span
    w = (1 / se2) / (1 / se2 + 1 / tau2)
    return max(-MU_CLAMP, min(MU_CLAMP, w * mu + (1 - w) * m)), 1 / (1 / se2 + 1 / tau2), w, mu


def _parts(s, i, k, mu, v):
    """Log-space pieces of the band at origin i: drift, and the low/mid/high spreads before the width factor."""
    sp = s.spreads(i, k)
    if sp is None:
        return None
    du = math.sqrt(v) * H[k] / 252          # uncertainty in the drift itself
    return mu * H[k] / 252, (sp[0] - 1.2816 * du, 0.0, sp[2] + 1.2816 * du)


def _band(c, drift, sp, kw, cap=None):
    """Prices for the band. The range always includes the unchanged price and the drifted one."""
    lo = min(drift + kw * sp[0], kw * sp[0], 0.0)
    hi = max(drift + kw * sp[2], kw * sp[2], 0.0)
    out = [c * math.exp(lo), c * math.exp(drift), c * math.exp(hi)]
    if cap:
        out = [min(c * (1 + cap), max(c * (1 - cap), x)) for x in out]
    return out


def _collect(S, k, prior, frm, to):
    """(actual log move, drift, spreads, ticker, price) for every origin in [frm, to), using data up to the origin."""
    h, out = H[k], []
    for t, s in S.items():
        a, b = s.idx_before(frm) + 1, s.idx_before(to) + 1
        for o in range(max(a, 300, s.first + 120), min(b, len(s.c) - h), STEP):
            mu, v, _, _ = _posterior(s, o, prior)
            p = _parts(s, o, k, mu, v)
            if p:
                out.append((s.lc[o + h] - s.lc[o], p[0], p[1], t, s.c[o]))
    return out


def _covered(row, kw, cap):
    a, drift, sp, t, c = row
    lo, _, hi = _band(c, drift, sp, kw, cap.get(t) if cap else None)
    x = c * math.exp(a)
    return lo * (1 - 1e-9) <= x <= hi * (1 + 1e-9)


def _tune(rows, cap, target=0.80):
    """Smallest width factor (0.75-2.5) at which the pooled ranges held `target` of the time. Bounded so one
    unusual window cannot make the ranges absurd; any shortfall shows up in the published test results."""
    if not rows:
        return 1.0
    lo, hi = 0.75, 2.5
    for _ in range(25):
        mid = (lo + hi) / 2
        cov = sum(_covered(r, mid, cap) for r in rows) / len(rows)
        lo, hi = (lo, mid) if cov >= target else (mid, hi)
    return hi


def fit(rows_by_t: dict, caps: dict):
    """rows_by_t: ticker -> adjusted rows [date, open, high, low, close, volume, turnover], oldest first."""
    S = {t: Series(r) for t, r in rows_by_t.items() if len(r) > 300 and any(x[5] > 0 for x in r)}
    end = max(s.d[-1] for s in S.values())
    meta = {"method": "drift shrunk to the DSE median; ranges from each share's own past moves (lognormal from a year out), width tuned to hold 80%",
            "test_from": TEST_FROM, "tuned_on": [CAL[0], CAL[1]], "held": {}, "err": {}, "n": {}, "width": {}}
    cap1 = {t: caps.get(t, 0.15) for t in S}

    # ---- validation: tune on CAL, test from TEST_FROM (zq from data before each window) ----
    p_cal, p_test = _prior(S, CAL[0]), _prior(S, TEST_FROM)
    k_live, per_share = {}, {t: {} for t in S}
    for k in H:
        kw = _tune(_collect(S, k, p_cal, *CAL), cap1 if k == "1d" else None)
        test = _collect(S, k, p_test, TEST_FROM, "9999")
        if test:
            hits = [_covered(r, kw, cap1 if k == "1d" else None) for r in test]
            meta["held"][k] = round(sum(hits) / len(hits), 3)
            meta["n"][k] = len(hits)
            err_m = median(abs(r[0] - r[1]) for r in test)
            err_0 = median(abs(r[0]) for r in test)
            meta["err"][k] = [round(err_m, 4), round(err_0, 4)]     # median |log error|: model vs "no change"
            for r, hit in zip(test, hits):
                per_share[r[3]].setdefault(k, []).append(hit)
        # live width: re-tuned on the most recent window with everything before it
        k_live[k] = _tune(test, cap1 if k == "1d" else None) if test else kw
        meta["width"][k] = round(k_live[k], 2)

    # ---- live model: all data ----
    prior = _prior(S)
    meta["prior"] = round(math.exp(prior[0]) - 1, 4)
    meta["tau"] = round(math.sqrt(prior[1]), 4)
    models = {}
    for t, s in S.items():
        i = len(s.c) - 1
        mu, v, w, own = _posterior(s, i, prior)
        m = {"asof": s.d[i], "price": s.c[i], "g": round(math.exp(mu) - 1, 4), "own": round(math.exp(own) - 1, 4) if own is not None else None,
             "w": round(w, 2), "vol": round(s.sig(i, "1y") * math.sqrt(252), 4), "cap": cap1[t], "h": {},
             "held": {k: round(sum(x) / len(x), 2) for k, x in per_share[t].items() if len(x) >= 20}}
        p1 = None
        for k in H:
            p = _parts(s, i, k, mu, v)
            if p is None:
                continue
            if k == "1y":
                p1 = p
            m["h"][k] = [round(x, 2) for x in _band(s.c[i], p[0], p[1], k_live[k], cap1[t] if k == "1d" else None)]
        # several years: the tuned 1-year lognormal spread grows with the square root of time, plus drift uncertainty
        if p1:
            sd1 = p1[1][2] / 1.2816 * k_live["1y"]
            for y in YEARS:
                tot = math.sqrt(sd1 ** 2 * y + v * y * y)
                m["h"][f"{y}y"] = [round(s.c[i] * math.exp(mu * y + z * tot), 2) for z in (-1.2816, 0.0, 1.2816)]
        models[t] = m
    meta["asof"] = end
    return models, meta
