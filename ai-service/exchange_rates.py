"""The European Central Bank's daily euro reference rates, for converting a
user's expected salary (salary.py) when they've allowed it.

The ECB publishes about 30 currencies against the euro once a working day,
around 16:00 CET (free, no key). The scheduler fetches them every 6 hours into
"ExchangeRate" (one row per currency, replaced each time). A rate older than
salary.MAX_RATE_AGE_DAYS isn't used: the question stops for the user rather
than being answered with an old rate.
"""

import logging
import xml.etree.ElementTree as ET
from datetime import date

import httpx

from salary import Rates

logger = logging.getLogger(__name__)

ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"


def parse_ecb(xml_text: str) -> Rates:
    """The rates in the ECB's daily file (units per euro, plus EUR = 1)."""
    root = ET.fromstring(xml_text)
    day = None
    per_eur: dict[str, float] = {"EUR": 1.0}
    for el in root.iter():
        if el.tag.endswith("Cube") and el.get("time"):
            day = date.fromisoformat(el.get("time"))
        if el.tag.endswith("Cube") and el.get("currency") and el.get("rate"):
            rate = float(el.get("rate"))
            if rate > 0:
                per_eur[el.get("currency")] = rate
    if day is None or len(per_eur) < 2:
        raise ValueError("no rates in the ECB file")
    return Rates(day, per_eur)


async def fetch_ecb(client: httpx.AsyncClient | None = None) -> Rates:
    own = client is None
    client = client or httpx.AsyncClient(timeout=20)
    try:
        res = await client.get(ECB_DAILY_URL)
        res.raise_for_status()
        return parse_ecb(res.text)
    finally:
        if own:
            await client.aclose()


async def store_rates(conn, rates: Rates) -> None:
    """Replace the stored rates. A currency the ECB no longer publishes is
    removed rather than left behind at an old date."""
    async with conn.transaction():
        await conn.execute('DELETE FROM "ExchangeRate" WHERE currency <> ALL($1::text[])', list(rates.per_eur))
        for currency, rate in rates.per_eur.items():
            await conn.execute(
                'INSERT INTO "ExchangeRate" (currency, per_eur, rate_date, fetched_at) VALUES ($1, $2, $3, NOW()) '
                "ON CONFLICT (currency) DO UPDATE SET per_eur = EXCLUDED.per_eur, "
                "rate_date = EXCLUDED.rate_date, fetched_at = NOW()",
                currency,
                rate,
                rates.rate_date,
            )


async def load_rates(conn) -> Rates | None:
    """The stored rates, with the oldest rate date among them (so one
    currency left behind makes the whole set count as old). None if empty."""
    rows = await conn.fetch('SELECT currency, per_eur, rate_date FROM "ExchangeRate"')
    if not rows:
        return None
    return Rates(min(r["rate_date"] for r in rows), {r["currency"]: float(r["per_eur"]) for r in rows})
