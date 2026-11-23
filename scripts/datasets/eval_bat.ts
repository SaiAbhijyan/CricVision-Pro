import { readFileSync } from "fs";
import { decodeObb, obbEnds, letterbox } from "../../lib/cv/bat";
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const S = 512, errs: number[] = [], angs: number[] = []; let found = 0, gtN = 0, fp = 0;
for (const r of rows) {
  const lb = letterbox(r.W, r.H, S), flat = (r.data as number[][]).flat();
  const boxes = decodeObb(flat, r.n).map((b) => ({ ...b, cx: (b.cx - lb.px) / lb.r, cy: (b.cy - lb.py) / lb.r, w: b.w / lb.r, h: b.h / lb.r }));
  for (const g of r.gt) {
    gtN++;
    const c = [0, 1, 2, 3].map((i) => ({ x: g[2 * i] * r.W, y: g[2 * i + 1] * r.H }));
    const d = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y), m = (a: any, b: any) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    // ground-truth bat ends: midpoints of the two short edges of the labelled box
    const e01 = d(c[0], c[1]), e12 = d(c[1], c[2]);
    const ends = e01 < e12 ? [m(c[0], c[1]), m(c[2], c[3])] : [m(c[1], c[2]), m(c[3], c[0])], L = d(ends[0], ends[1]);
    const best = boxes.map((b) => { const p = obbEnds(b); const e = Math.min(Math.max(d(p[0], ends[0]), d(p[1], ends[1])), Math.max(d(p[0], ends[1]), d(p[1], ends[0]))); return { e, p }; }).sort((a, b) => a.e - b.e)[0];
    if (!best || best.e > 0.5 * L) continue;
    found++; errs.push(best.e / L);
    const ag = (u: any, v: any) => Math.atan2(v.y - u.y, v.x - u.x);
    let da = Math.abs(ag(best.p[0], best.p[1]) - ag(ends[0], ends[1])) % Math.PI; da = Math.min(da, Math.PI - da); angs.push((da * 180) / Math.PI);
  }
  fp += Math.max(0, boxes.length - r.gt.length);
}
const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))];
console.log(`bats found ${found}/${gtN}; extra boxes ${fp} over ${rows.length} images`);
console.log(`worst-end error as % of bat length: median ${(100 * q(errs, 0.5)).toFixed(1)}%, p90 ${(100 * q(errs, 0.9)).toFixed(1)}%`);
console.log(`bat angle error: median ${q(angs, 0.5).toFixed(1)} deg, p90 ${q(angs, 0.9).toFixed(1)} deg, max ${Math.max(...angs).toFixed(1)}`);
