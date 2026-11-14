"""NAVView TZ (navviewtz.com): latest NAV, returns and size for every licensed collective investment scheme.

The /showcase page embeds the app state as window.__INITIAL_STATE__ (a JSON string inside a JS string)."""
from __future__ import annotations

import json

from ..common import Http

URL = "https://www.navviewtz.com/showcase"
KEEP = ["fund_id", "fund_name", "fund_name_short", "manager", "fund_manager_short", "manager_link", "fund_page_link",
        "type", "currency", "risk_level", "redemption_days", "inception_date", "date", "nav_per_unit", "sale_price",
        "repurchase_price", "nav_total", "units_outstanding", "ret_1w", "ret_1m", "ret_3m", "ret_ytd", "ret_1y",
        "ret_as_of", "latest_effective_annual_yield", "latest_yield_date", "closing_price", "closing_price_date",
        "premium_discount", "performance_basis", "volatility_30d", "max_drawdown", "sparkline_1y", "freshness_status"]


def fetch(http: Http | None = None) -> list[dict]:
    http = http or Http()
    html = http.get(URL)
    i = html.find("window.__INITIAL_STATE__=")
    if i < 0:
        raise RuntimeError("NAVView: __INITIAL_STATE__ not found (page layout changed?)")
    j = html.find("</script>", i)
    raw = html[i + len("window.__INITIAL_STATE__="):j].strip().rstrip(";")
    state = json.loads(json.loads(raw))
    funds = state["pinia"]["funds"]["latestFunds"]
    if len(funds) < 10:
        raise RuntimeError(f"NAVView: only {len(funds)} funds in state")
    return [{k: f.get(k) for k in KEEP} for f in funds]
