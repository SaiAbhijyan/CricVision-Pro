/**
 * Camera-cut detection for broadcast and highlight footage. A compilation is many camera shots joined together; ball tracks,
 * pose windows and the pitch calibration are only valid inside one shot, so analysis restarts at every cut.
 * A cut is a frame whose coarse luma histogram AND coarse picture both change abruptly (a pan changes the picture but not the
 * histogram; a flash changes the histogram but not the layout), measured against the recent frame-to-frame baseline.
 */
import type { Gray } from "@/lib/cv/ball-detector";

const GW = 32, GH = 18, BINS = 16;

interface Sig { hist: Float32Array; grid: Float32Array }

function signature(g: Gray): Sig {
  const hist = new Float32Array(BINS), grid = new Float32Array(GW * GH), cnt = new Float32Array(GW * GH);
  const sx = g.w / GW, sy = g.h / GH, step = Math.max(1, Math.floor(Math.min(sx, sy) / 3));
  let n = 0;
  for (let y = 0; y < g.h; y += step) {
    const gy = Math.min(GH - 1, Math.floor(y / sy)), row = y * g.w;
    for (let x = 0; x < g.w; x += step) {
      const v = g.data[row + x], c = gy * GW + Math.min(GW - 1, Math.floor(x / sx));
      hist[Math.min(BINS - 1, v >> 4)]++; grid[c] += v; cnt[c]++; n++;
    }
  }
  for (let i = 0; i < BINS; i++) hist[i] /= Math.max(1, n);
  for (let i = 0; i < grid.length; i++) grid[i] /= Math.max(1, cnt[i]);
  return { hist, grid };
}

/** histogram distance in 0..1 (half the L1) and mean absolute grid difference in gray levels */
function distance(a: Sig, b: Sig) {
  let h = 0, g = 0;
  for (let i = 0; i < BINS; i++) h += Math.abs(a.hist[i] - b.hist[i]);
  for (let i = 0; i < a.grid.length; i++) g += Math.abs(a.grid[i] - b.grid[i]);
  return { h: h / 2, g: g / a.grid.length };
}

export class CutDetector {
  private prev: Sig | null = null;
  private ring: { t: number; s: Sig }[] = [];
  private base: number[] = [];
  private lastCut = -Infinity;
  cuts: number[] = [];
  constructor(private minShotS = 0.4) {}

  /** Feed frames in time order; returns true when this frame starts a new camera shot. */
  push(t: number, g: Gray): boolean {
    const s = signature(g), p = this.prev;
    this.prev = s;
    if (!p) return false;
    const d = distance(p, s);
    const sorted = [...this.base].sort((a, b) => a - b), med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 2;
    this.ring.push({ t, s }); while (this.ring.length > 2 && t - this.ring[0].t > 0.4) this.ring.shift();
    const hard = (d.g > Math.max(18, 5 * med) && d.h > 0.12) || (d.g > Math.max(18, 2 * med) && d.h > 0.4);
    // dissolves and wipes: no single frame jumps, but over 0.4 s both the layout and the tonal mix are replaced
    let soft = false;
    const old = this.ring[0];
    if (!hard && old && t - old.t >= 0.3) { const D = distance(old.s, s); soft = D.g > 20 && D.h > 0.2 && d.g > 2 * med; }
    if ((!hard && !soft) || t - this.lastCut < this.minShotS) { this.base.push(d.g); if (this.base.length > 30) this.base.shift(); return false; }
    const at = soft ? (old.t + t) / 2 : t;
    this.lastCut = t; this.cuts.push(at); this.base = []; this.ring = [{ t, s }];
    return true;
  }
  reset() { this.prev = null; this.ring = []; this.base = []; this.lastCut = -Infinity; this.cuts = []; }
}

export interface Shot { start: number; end: number }
/** Shots between cuts, dropping slivers shorter than `minS`. */
export function shotsFromCuts(cuts: number[], duration: number, minS = 0.4): Shot[] {
  const edges = [0, ...cuts.filter((c) => c > 0 && c < duration).sort((a, b) => a - b), duration];
  const out: Shot[] = [];
  for (let i = 0; i < edges.length - 1; i++) if (edges[i + 1] - edges[i] >= minS) out.push({ start: edges[i], end: edges[i + 1] });
  return out;
}
