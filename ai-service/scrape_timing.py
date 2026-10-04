"""Where the daily scrape's time goes.

/scrape-and-store has to fit the workflow's 55 min SSH timeout. Each phase is
timed per location and the report is printed and returned in the endpoint's
JSON, which the Daily Scrape workflow's log shows (curl's output).
"""
import time
from collections import defaultdict
from contextlib import contextmanager


class PhaseTimer:
    def __init__(self) -> None:
        self._start = time.perf_counter()
        self._seconds: dict[tuple[str, str], float] = defaultdict(float)
        self._items: dict[tuple[str, str], int] = defaultdict(int)

    @contextmanager
    def phase(self, name: str, location: str = "", items: int = 1):
        t = time.perf_counter()
        try:
            yield
        finally:
            self._seconds[(name, location)] += time.perf_counter() - t
            self._items[(name, location)] += items

    def add(self, name: str, location: str, seconds: float, items: int = 1) -> None:
        self._seconds[(name, location)] += seconds
        self._items[(name, location)] += items

    def count(self, name: str, location: str = "", items: int = 1) -> None:
        """Items that took no time worth measuring (e.g. a skipped job)."""
        self._seconds[(name, location)] += 0.0
        self._items[(name, location)] += items

    def rows(self) -> list[dict]:
        rows = [
            {
                "phase": name,
                "location": location,
                "seconds": round(secs, 1),
                "items": self._items[(name, location)],
                "seconds_per_item": round(secs / self._items[(name, location)], 2)
                if self._items[(name, location)]
                else None,
            }
            for (name, location), secs in self._seconds.items()
        ]
        return sorted(rows, key=lambda r: (r["phase"], r["location"]))

    def report(self) -> dict:
        totals: dict[str, float] = defaultdict(float)
        for r in self.rows():
            totals[r["phase"]] += r["seconds"]
        return {
            "total_seconds": round(time.perf_counter() - self._start, 1),
            "by_phase": dict(sorted(totals.items(), key=lambda kv: -kv[1])),
            "detail": self.rows(),
        }

    def print_report(self) -> None:
        rep = self.report()
        print(f"[scrape-timing] total {rep['total_seconds'] / 60:.1f} min")
        for name, secs in rep["by_phase"].items():
            print(f"[scrape-timing]   {name:<34} {secs / 60:6.1f} min")
        for r in rep["detail"]:
            per = f"{r['seconds_per_item']}s/item" if r["seconds_per_item"] is not None else ""
            print(
                f"[scrape-timing]     {r['phase']:<32} {r['location'] or '-':<18} "
                f"{r['seconds']:8.1f}s  {r['items']:5d} items  {per}"
            )
