"""Shared helpers: HTTP with retries and cookies, atomic JSON writes, small date utilities.

Standard library only, so the pipeline runs anywhere Python 3.10+ is installed (locally or in GitHub Actions)."""
from __future__ import annotations

import datetime as dt
import gzip
import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = Path(__file__).resolve().parent / "config"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 mtaji-data-pipeline"


class Http:
    """A tiny session: keeps cookies between calls (UTT AMIS needs a CSRF cookie), retries on failure."""

    def __init__(self, retries: int = 3, timeout: int = 60, pause: float = 0.4):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.retries, self.timeout, self.pause = retries, timeout, pause

    def request(self, url: str, data: dict | None = None, headers: dict | None = None) -> str:
        h = {"User-Agent": UA, "Accept-Encoding": "gzip", "Accept-Language": "en"}
        h.update(headers or {})
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        last = None
        for attempt in range(self.retries):
            try:
                req = urllib.request.Request(url, data=body, headers=h)
                with self.opener.open(req, timeout=self.timeout) as r:
                    raw = r.read()
                    if r.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                    time.sleep(self.pause)
                    return raw.decode("utf8", errors="replace")
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last = e
                time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"GET {url} failed after {self.retries} tries: {last}")

    get = request


def read_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, obj, compact: bool = True) -> None:
    """Write via a temp file so a failed run never leaves a half-written data file behind."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 2)
    tmp.write_text(text + "\n", encoding="utf8")
    os.replace(tmp, path)


def config(name: str):
    return json.loads((CONFIG / name).read_text(encoding="utf8"))


def today() -> dt.date:
    # East Africa Time (UTC+3), so a run late in the evening counts as that day
    return (dt.datetime.utcnow() + dt.timedelta(hours=3)).date()


def d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def r4(x):
    return None if x is None else round(float(x), 4)


def pct(x, nd=2):
    """Decimal return -> percent, rounded; None stays None."""
    return None if x is None else round(float(x) * 100, nd)
