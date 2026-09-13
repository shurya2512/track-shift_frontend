import { CircuitOutline, circuitFor } from '../circuits';
import { TrackGeometry } from '../types';

const POINTS = 240;

/** A closed circuit-like loop, used only where no recorded outline exists. */
function loopPoint(theta: number): [number, number] {
  const r = 1200 + 340 * Math.sin(3 * theta) + 150 * Math.cos(2 * theta);
  return [r * Math.cos(theta), r * Math.sin(theta) * 0.72];
}

function syntheticOutline(name: string): CircuitOutline {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    const [px, py] = loopPoint((i / POINTS) * Math.PI * 2);
    x.push(px);
    y.push(py);
  }
  return { name, lapLengthM: 0, baseLapS: 88, source: 'generated loop — no recorded outline', x, y };
}

export interface FixtureTrack {
  geometry: TrackGeometry;
  /** Position at a fraction (0..1) of the way round the lap, by arc length. */
  pointAt(frac: number): { x: number; y: number };
  /** A representative lap on this circuit, in seconds. */
  baseLapS: number;
  /** Where the outline came from, so the page never implies a surveyed map. */
  source: string;
}

/**
 * The recorded outline for an event, or a generated loop where none exists.
 *
 * The recorded circuits carry their own lap distance, so the geometry's arc length is
 * scaled onto it — a car's distance round the lap is then in real metres, not in the
 * arbitrary units the resampled outline happens to have.
 */
export function buildTrack(event: string): FixtureTrack {
  const outline = circuitFor(event) ?? syntheticOutline(event);
  const { x, y } = outline;
  const count = x.length;

  // Cumulative arc length, so distance round the lap maps to a real position.
  const cumulative: number[] = [0];
  for (let i = 1; i <= count; i++) {
    const j = i % count;
    const dx = x[j] - x[i - 1];
    const dy = y[j] - y[i - 1];
    cumulative.push(cumulative[i - 1] + Math.hypot(dx, dy));
  }
  const outlineLengthM = cumulative[count];
  const lapLengthM = outline.lapLengthM > 0 ? outline.lapLengthM : outlineLengthM;

  const pointAt = (frac: number) => {
    const target = (((frac % 1) + 1) % 1) * outlineLengthM;
    let i = 1;
    while (i < count && cumulative[i] < target) i++;
    const span = cumulative[i] - cumulative[i - 1];
    const t = span === 0 ? 0 : (target - cumulative[i - 1]) / span;
    const j = i % count;
    return {
      x: x[i - 1] + (x[j] - x[i - 1]) * t,
      y: y[i - 1] + (y[j] - y[i - 1]) * t,
    };
  };

  return {
    geometry: { name: outline.name, x, y, lapLengthM },
    pointAt,
    baseLapS: outline.baseLapS,
    source: outline.source,
  };
}
