#!/usr/bin/env python3
"""Regenerate `src/lib/race/circuits.ts` from recorded position telemetry.

The previous backend curated one flying lap per circuit under
`track-shift/data/ml_datasets/<year>/dataset_<year>_<Event>.csv`, with FastF1's X/Y
position samples in tenths of a metre. This reads one driver's lap per circuit,
resamples it by arc length into an evenly spaced closed loop, centres it on its own
centroid and writes it out in metres.

    python3 scripts/generate_circuits.py [--datasets PATH]

`--datasets` defaults to the sibling checkout the datasets live in.
"""
from __future__ import annotations

import argparse
import csv
import math
import os

DEFAULT_DATASETS = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "track-shift", "data", "ml_datasets")
)
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "src", "lib", "race", "circuits.ts"))

# Points per resampled lap. High enough that the hairpins stay sharp, low enough that
# the generated module stays a readable size.
POINTS = 260

# Event name as the setup screen spells it -> dataset file, circuit name, and a
# representative dry race lap in seconds used as the fixture's base pace.
EVENTS: list[tuple[str, str, str, float]] = [
    ("Australian Grand Prix", "2025/dataset_2025_Australian_Grand_Prix.csv", "Albert Park Circuit", 82.5),
    ("Chinese Grand Prix", "2026/dataset_2026_Chinese_Grand_Prix.csv", "Shanghai International Circuit", 96.5),
    ("Japanese Grand Prix", "2026/dataset_2026_Japanese_Grand_Prix.csv", "Suzuka International Racing Course", 94.0),
    ("Miami Grand Prix", "2026/dataset_2026_Miami_Grand_Prix.csv", "Miami International Autodrome", 93.0),
    ("Canadian Grand Prix", "2026/dataset_2026_Canadian_Grand_Prix.csv", "Circuit Gilles Villeneuve", 76.5),
    ("Monaco Grand Prix", "2026/dataset_2026_Monaco_Grand_Prix.csv", "Circuit de Monaco", 76.0),
    ("Barcelona Grand Prix", "2026/dataset_2026_Barcelona_Grand_Prix.csv", "Circuit de Barcelona-Catalunya", 80.5),
    ("Austrian Grand Prix", "2026/dataset_2026_Austrian_Grand_Prix.csv", "Red Bull Ring", 69.5),
    ("British Grand Prix", "2026/dataset_2026_British_Grand_Prix.csv", "Silverstone Circuit", 90.5),
]


def load_lap(path: str) -> tuple[str, list[float], list[float], float]:
    """One driver's lap: X and Y in metres, plus the lap distance the source recorded."""
    by_driver: dict[str, list[dict[str, str]]] = {}
    with open(path) as fh:
        for row in csv.DictReader(fh):
            by_driver.setdefault(row["Driver"], []).append(row)
    driver = "VER" if "VER" in by_driver else max(by_driver, key=lambda d: len(by_driver[d]))
    rows = sorted(by_driver[driver], key=lambda r: float(r["distance"]))
    xs = [float(r["X"]) / 10.0 for r in rows]
    ys = [float(r["Y"]) / 10.0 for r in rows]
    return driver, xs, ys, max(float(r["distance"]) for r in rows)


def resample(xs: list[float], ys: list[float], count: int) -> tuple[list[float], list[float]]:
    """Evenly space `count` points by arc length round the closed loop.

    The source samples are spaced by distance travelled, so a slow corner carries more of
    them than a straight. Respacing them keeps the drawn outline's line weight even.
    """
    px, py = xs + [xs[0]], ys + [ys[0]]
    cumulative = [0.0]
    for i in range(1, len(px)):
        cumulative.append(cumulative[-1] + math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]))
    total = cumulative[-1]

    out_x, out_y = [], []
    j = 1
    for i in range(count):
        target = total * i / count
        while j < len(cumulative) - 1 and cumulative[j] < target:
            j += 1
        span = cumulative[j] - cumulative[j - 1]
        t = 0.0 if span == 0 else (target - cumulative[j - 1]) / span
        out_x.append(px[j - 1] + (px[j] - px[j - 1]) * t)
        out_y.append(py[j - 1] + (py[j] - py[j - 1]) * t)
    return out_x, out_y


def smooth(values: list[float], window: int = 3) -> list[float]:
    """A circular moving average, to take position jitter out of the outline."""
    n = len(values)
    return [
        sum(values[(i + k) % n] for k in range(-window, window + 1)) / (2 * window + 1)
        for i in range(n)
    ]


def wrap(values: list[float]) -> str:
    """Wrap a long numeric list so the generated module stays readable."""
    lines, line = [], "    "
    for value in values:
        token = f"{value:g}, "
        if len(line) + len(token) > 98:
            lines.append(line.rstrip())
            line = "    "
        line += token
    lines.append(line.rstrip().rstrip(","))
    return "\n".join(lines)


HEADER = '''/**
 * Real circuit centrelines, in metres, centred on each circuit's own centroid.
 *
 * Generated from the recorded position telemetry the previous backend curated under
 * `track-shift/data/ml_datasets` — one driver's flying lap per circuit, resampled by arc
 * length to an evenly spaced closed loop. The outlines are the actual circuits, so the
 * race map is the real shape rather than a synthetic one. `source` names the dataset and
 * driver each outline came from.
 *
 * DO NOT EDIT BY HAND — regenerate with `python3 scripts/generate_circuits.py`.
 */

export interface CircuitOutline {
  /** The circuit's own name, not the event's. */
  name: string;
  /** Official lap distance in metres, from the recorded lap. */
  lapLengthM: number;
  /** A representative dry race lap in seconds, used as the fixture's base pace. */
  baseLapS: number;
  /** The dataset and driver this outline was taken from. */
  source: string;
  x: number[];
  y: number[];
}

/** Keyed by the event name the setup screen uses. */
export const CIRCUITS: Record<string, CircuitOutline> = {
'''

FOOTER = '''};

export const circuitFor = (event: string): CircuitOutline | undefined => CIRCUITS[event];
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--datasets", default=DEFAULT_DATASETS, help="ml_datasets directory")
    args = parser.parse_args()

    blocks = []
    for event, relative, circuit, base_lap_s in EVENTS:
        path = os.path.join(args.datasets, relative)
        if not os.path.exists(path):
            raise SystemExit(f"missing dataset for {event}: {path}")
        driver, xs, ys, lap_m = load_lap(path)
        xs, ys = resample(xs, ys, POINTS)
        xs, ys = smooth(xs), smooth(ys)
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        xs = [round(x - cx, 1) for x in xs]
        ys = [round(y - cy, 1) for y in ys]
        blocks.append(
            f"""  '{event}': {{
    name: '{circuit}',
    lapLengthM: {round(lap_m)},
    baseLapS: {base_lap_s},
    source: '{os.path.basename(path)} · {driver}',
    x: [
{wrap(xs)}
    ],
    y: [
{wrap(ys)}
    ],
  }},"""
        )
        print(f"{event:28s} {os.path.basename(path):44s} {driver} {lap_m:.0f} m")

    with open(OUT, "w") as fh:
        fh.write(HEADER + "\n".join(blocks) + "\n" + FOOTER)
    print(f"\nwrote {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB, {len(EVENTS)} circuits)")


if __name__ == "__main__":
    main()
