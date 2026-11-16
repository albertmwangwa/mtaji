"""Run the data pipeline.

    python -m pipeline              # everything
    python -m pipeline funds        # UTT AMIS + NAVView only
    python -m pipeline dse          # DSE only
    python -m pipeline treasury     # BoT auctions + exchange rates

Writes into ../data. A source that fails keeps its previous file, and the failure is recorded in data/meta.json,
so the website always has a complete, consistent set of files."""
from __future__ import annotations

import sys
import traceback

from . import build
from .common import DATA, Http, config, now_iso, read_json, today, write_json
from .sources import bot, dse, navview, utt


def log(*a):
    print(*a, flush=True)


def run_funds(meta: dict) -> None:
    http = Http()
    cfg = config("funds.json")
    utt_hist = nv = None
    try:
        utt_hist = utt.fetch(http)
        n = sum(len(v) for v in utt_hist.values())
        meta["sources"]["utt"] = {"ok": True, "at": now_iso(), "rows": n, "asof": max(v[-1][0] for v in utt_hist.values())}
        log(f"UTT AMIS: {n} NAV rows for {len(utt_hist)} funds")
    except Exception as e:
        meta["sources"]["utt"] = {"ok": False, "at": now_iso(), "error": str(e)}
        log("UTT AMIS FAILED:", e)
    try:
        nv = navview.fetch(http)
        write_json(DATA / "raw" / "navview.json", nv)
        meta["sources"]["navview"] = {"ok": True, "at": now_iso(), "funds": len(nv), "asof": max(f["date"] or "" for f in nv)}
        log(f"NAVView TZ: {len(nv)} funds")
    except Exception as e:
        nv = read_json(DATA / "raw" / "navview.json", [])
        meta["sources"]["navview"] = {"ok": False, "at": now_iso(), "error": str(e), "fallback": bool(nv)}
        log("NAVView FAILED:", e, "(using the last saved copy)" if nv else "")
    prev_hist = read_json(DATA / "funds-history.json", {})
    funds, hist, warn = build.build_funds(cfg, utt_hist, nv, prev_hist, today().isoformat())
    write_json(DATA / "funds.json", {"updated": now_iso(), "funds": funds})
    write_json(DATA / "funds-history.json", hist)
    meta["warnings"] += warn
    log(f"funds.json: {sum(1 for f in funds if f.get('nav'))} funds with prices")


def run_dse(meta: dict) -> None:
    cfg = config("dse.json")
    raw = dse.fetch(list(cfg["tickers"]), log=log)
    ok = [t for t, v in raw.items() if v.get("rows")]
    prev = read_json(DATA / "dse.json")
    out, warn = build.build_dse(cfg, raw, prev)
    if not ok and prev:
        meta["sources"]["dse"] = {"ok": False, "at": now_iso(), "error": "no company pages could be read"}
        log("DSE FAILED: kept previous dse.json")
        return
    out["updated"] = now_iso()
    http = Http()
    try:   # indices, market cap and the price ticker (ETFs are recorded day by day here)
        mk = dse.market(http)
        funds = (read_json(DATA / "funds.json", {}) or {}).get("funds", [])
        out["market"].update(build.build_market(mk, (prev or {}).get("market"), funds, out["asof"]))
        log(f"DSE market: {len(mk['indices'])} indices, {len(out['market']['etfs'])} ETFs")
    except Exception as e:
        if prev and prev.get("market", {}).get("indices"):
            out["market"].update({k: v for k, v in prev["market"].items() if k not in out["market"]})
        meta["warnings"].append(f"DSE market page: {e}")
    try:
        lb = dse.listed_bonds(http)
        bonds = build.build_bonds(lb, out["asof"])
        write_json(DATA / "bonds.json", bonds)
        log(f"bonds.json: {bonds['summary']['gov_count']} government, {bonds['summary']['corp_count']} corporate bonds")
    except Exception as e:
        meta["warnings"].append(f"DSE listed bonds: {e} (kept the previous bonds.json)")
    write_json(DATA / "dse.json", out)
    meta["sources"]["dse"] = {"ok": len(ok) == len(raw), "at": now_iso(), "companies": len(ok), "of": len(raw), "asof": out["asof"]}
    meta["warnings"] += warn
    log(f"dse.json: {len(ok)}/{len(raw)} companies, prices as of {out['asof']}")


def run_treasury(meta: dict) -> None:
    http = Http(pause=0.3)
    prev = read_json(DATA / "treasury.json", {})
    bills = bot.bills(http)
    bonds = bot.bonds(http)
    if not bills or not bonds:
        raise RuntimeError(f"BoT returned {len(bills)} bill and {len(bonds)} bond auctions")
    out = build.build_treasury(bills, bonds, prev, today().isoformat())
    out["updated"] = now_iso()
    write_json(DATA / "treasury.json", out)
    meta["sources"]["treasury"] = {"ok": True, "at": now_iso(), "asof": out["asof"], "bill_auctions": len(bills), "bond_auctions": len(bonds)}
    log(f"treasury.json: {len(bills)} bill and {len(bonds)} bond auctions, latest {out['asof']}")
    try:
        f = bot.fx(http)
        prevfx = read_json(DATA / "fx.json", {}) or {}
        hist = prevfx.get("usd", [])
        if f["date"] and (not hist or hist[-1][0] < f["date"]):
            hist.append([f["date"], f["rates"]["USD"]["mean"]])
        write_json(DATA / "fx.json", {"date": f["date"], "rates": f["rates"], "usd": hist[-800:], "updated": now_iso()})
        meta["sources"]["fx"] = {"ok": True, "at": now_iso(), "asof": f["date"], "currencies": len(f["rates"])}
        log(f"fx.json: {len(f['rates'])} currencies, USD {f['rates']['USD']['mean']}")
    except Exception as e:
        meta["sources"]["fx"] = {"ok": False, "at": now_iso(), "error": str(e)}


def main(argv: list[str]) -> int:
    jobs = set(argv) or {"funds", "dse", "treasury"}
    meta = read_json(DATA / "meta.json", {}) or {}
    meta.setdefault("sources", {})
    meta["warnings"] = []
    for name, fn in (("funds", run_funds), ("dse", run_dse), ("treasury", run_treasury)):
        if name in jobs:
            try:
                fn(meta)
            except Exception:
                traceback.print_exc()
                meta["sources"][name] = {"ok": False, "at": now_iso(), "error": traceback.format_exc(limit=1)}
    meta["updated"] = now_iso()
    write_json(DATA / "meta.json", meta, compact=False)
    for w in meta["warnings"]:
        log("WARNING:", w)
    return 0 if all(s.get("ok") for s in meta["sources"].values()) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
