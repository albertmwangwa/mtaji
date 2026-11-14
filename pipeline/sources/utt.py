"""UTT AMIS: official daily NAV history for its six schemes.

uttamis.co.tz/fund-performance fills its table from a DataTables endpoint (POST /navs) guarded by a
Laravel CSRF token. We load the page once for the token and session cookie, then page through /navs."""
from __future__ import annotations

import re

from ..common import Http

BASE = "https://www.uttamis.co.tz"
# internal_name on the UTT site -> our fund id (same ids as NAVView TZ uses)
IDS = {"umoja": "utt.umoja", "wekeza": "utt.wekeza", "watoto": "utt.watoto",
       "jikimu": "utt.jikimu", "liquid": "utt.liquid", "bond": "utt.bond"}
PAGE = 5000


def _num(s) -> float:
    return float(str(s).replace(",", ""))


def _date(s: str) -> str:
    dd, mm, yy = s.split("-")          # "12-11-2026" -> "2026-11-12"
    return f"{yy}-{mm}-{dd}"


def fetch(http: Http | None = None) -> dict:
    """Return {fund_id: [[date, nav, sale, repurchase, aum, units], ...]} sorted by date."""
    http = http or Http()
    page = http.get(f"{BASE}/fund-performance")
    m = re.search(r'name="csrf-token" content="([^"]+)"', page)
    if not m:
        raise RuntimeError("UTT: CSRF token not found on fund-performance page")
    tok = m.group(1)
    hdr = {"X-CSRF-TOKEN": tok, "X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE}/fund-performance"}
    rows, start, total = [], 0, None
    import json
    while total is None or start < total:
        body = http.request(f"{BASE}/navs", data={"draw": 1, "start": start, "length": PAGE, "_token": tok, "csrf-token": tok}, headers=hdr)
        j = json.loads(body)
        total = int(j.get("recordsTotal") or 0)
        batch = j.get("data") or []
        if not batch:
            break
        rows += batch
        start += len(batch)
    out: dict[str, dict[str, list]] = {}
    for r in rows:
        fid = IDS.get(r.get("internal_name"))
        if not fid or r.get("deleted_at") or not r.get("is_approved", 1):
            continue
        day = _date(r["date_valued"])
        nav = _num(r["nav_per_unit"])
        if nav <= 0:
            continue
        out.setdefault(fid, {})[day] = [day, round(nav, 4), round(_num(r["sale_price_per_unit"]), 4),
                                        round(_num(r["repurchase_price_per_unit"]), 4),
                                        round(_num(r["net_asset_value"])), round(_num(r["outstanding_number_of_units"]), 2)]
    if not out:
        raise RuntimeError("UTT: no NAV rows returned")
    return {k: [v[day] for day in sorted(v)] for k, v in out.items()}
