import type { Calibration, CameraModel, Mat3, Pt, Vec3 } from "@/lib/types";
import { PITCH_LENGTH, PITCH_WIDTH, STUMP_HEIGHT } from "./constants";

/* ---------- small linear algebra ---------- */

/** Solve A x = b (n x n) by Gaussian elimination with partial pivoting. Returns null if singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export function mulMat3Vec(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function invertMat3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const id = 1 / det;
  return [
    A * id, -(b * i - c * h) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, -(a * f - c * d) * id,
    C * id, -(a * h - b * g) * id, (a * e - b * d) * id,
  ];
}

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o as Mat3;
}

/* ---------- homography ---------- */

/** Direct linear transform from exactly 4 point correspondences (h33 = 1). Maps src -> dst. */
export function computeHomography(src: Pt[], dst: Pt[]): Mat3 | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyH(H: Mat3, p: Pt): Pt {
  const [x, y, w] = mulMat3Vec(H, [p.x, p.y, 1]);
  return { x: x / w, y: y / w };
}

/** World pitch rectangle corners, order matches Calibration.corners. */
export const WORLD_CORNERS: [Pt, Pt, Pt, Pt] = [
  { x: -PITCH_WIDTH / 2, y: 0 },
  { x: PITCH_WIDTH / 2, y: 0 },
  { x: PITCH_WIDTH / 2, y: PITCH_LENGTH },
  { x: -PITCH_WIDTH / 2, y: PITCH_LENGTH },
];

/* ---------- camera model (planar pose from homography + vertical anchor) ---------- */

const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const scale3 = (a: number[], s: number) => [a[0] * s, a[1] * s, a[2] * s];

/**
 * Build the full camera model:
 *  1. H: ground plane -> image (4-point DLT).
 *  2. Focal length from the orthogonality of the two ground axes (principal point = image centre).
 *  3. Rotation/translation, with the sign of the vertical axis fixed by the 0.711 m stump-top anchor.
 */
export function buildCameraModel(cal: Calibration): CameraModel | null {
  const H = computeHomography(WORLD_CORNERS, cal.corners);
  if (!H) return null;
  const Hinv = invertMat3(H);
  if (!Hinv) return null;

  const cx = cal.imageWidth / 2;
  const cy = cal.imageHeight / 2;
  const T: Mat3 = [1, 0, -cx, 0, 1, -cy, 0, 0, 1];
  const Hc = mulMat3(T, H);
  const h1 = [Hc[0], Hc[3], Hc[6]];
  const h2 = [Hc[1], Hc[4], Hc[7]];
  const h3 = [Hc[2], Hc[5], Hc[8]];

  let f2 = NaN;
  const d = h1[2] * h2[2];
  if (Math.abs(d) > 1e-12) f2 = -(h1[0] * h2[0] + h1[1] * h2[1]) / d;
  if (!(f2 > 0)) {
    const den = h2[2] * h2[2] - h1[2] * h1[2];
    if (Math.abs(den) > 1e-12) f2 = (h1[0] * h1[0] + h1[1] * h1[1] - h2[0] * h2[0] - h2[1] * h2[1]) / den;
  }
  let f = Math.sqrt(f2);
  const maxDim = Math.max(cal.imageWidth, cal.imageHeight);
  if (!isFinite(f) || f < maxDim * 0.3 || f > maxDim * 6) f = maxDim * 1.1; // sane fallback (~ 50-70deg FOV)

  const Kinv = (v: number[]) => [v[0] / f, v[1] / f, v[2]];
  let r1 = Kinv(h1), r2 = Kinv(h2), t = Kinv(h3);
  const lam = 1 / norm3(r1);
  r1 = scale3(r1, lam); r2 = scale3(r2, lam); t = scale3(t, lam);
  if (t[2] < 0) { r1 = scale3(r1, -1); r2 = scale3(r2, -1); t = scale3(t, -1); }
  // Gram-Schmidt re-orthonormalisation
  r1 = scale3(r1, 1 / norm3(r1));
  const proj = dot3(r1, r2);
  r2 = [r2[0] - proj * r1[0], r2[1] - proj * r1[1], r2[2] - proj * r1[2]];
  r2 = scale3(r2, 1 / norm3(r2));
  const r3a = cross3(r1, r2);

  const build = (r3: number[]): CameraModel => ({
    H, Hinv, f, cx, cy,
    R: [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]],
    t: [t[0], t[1], t[2]],
    reprojErrorPx: 0, stumpTopErrorPx: 0,
    imageWidth: cal.imageWidth, imageHeight: cal.imageHeight,
  });

  const anchor = cal.stumpTop;
  const candA = build(r3a);
  const candB = build(scale3(r3a, -1));
  const errA = projectErr(candA, anchor);
  const errB = projectErr(candB, anchor);
  const cam = errA <= errB ? candA : candB;
  cam.stumpTopErrorPx = Math.min(errA, errB);

  let e = 0;
  for (let i = 0; i < 4; i++) {
    const p = applyH(H, WORLD_CORNERS[i]);
    e += Math.hypot(p.x - cal.corners[i].x, p.y - cal.corners[i].y);
  }
  cam.reprojErrorPx = e / 4;
  return cam;
}

function projectErr(cam: CameraModel, anchor: Pt): number {
  const p = project(cam, { x: 0, y: PITCH_LENGTH, z: STUMP_HEIGHT });
  return p ? Math.hypot(p.x - anchor.x, p.y - anchor.y) : Infinity;
}

/** World (X,Y,Z) -> image pixels. Null if behind the camera. */
export function project(cam: CameraModel, w: { x: number; y: number; z: number }): Pt | null {
  const { R, t, f, cx, cy } = cam;
  const xc = R[0] * w.x + R[1] * w.y + R[2] * w.z + t[0];
  const yc = R[3] * w.x + R[4] * w.y + R[5] * w.z + t[1];
  const zc = R[6] * w.x + R[7] * w.y + R[8] * w.z + t[2];
  if (zc <= 1e-6) return null;
  return { x: (f * xc) / zc + cx, y: (f * yc) / zc + cy };
}

/** Image pixel -> ground (Z = 0) point. */
export function pixelToGround(cam: CameraModel, p: Pt): Pt {
  return applyH(cam.Hinv, p);
}

/** Image pixel -> (X,Y) on the horizontal plane at height Z. */
export function unprojectAtHeight(cam: CameraModel, p: Pt, Z: number): Pt | null {
  const { R, t, f, cx, cy } = cam;
  // P = K [R|t]; columns for plane Z: p1, p2, Z*p3 + p4
  const K = (v: number[]) => [f * v[0] + cx * v[2], f * v[1] + cy * v[2], v[2]];
  const c1 = K([R[0], R[3], R[6]]);
  const c2 = K([R[1], R[4], R[7]]);
  const c3 = K([R[2], R[5], R[8]]);
  const c4 = K([t[0], t[1], t[2]]);
  const col3 = [Z * c3[0] + c4[0], Z * c3[1] + c4[1], Z * c3[2] + c4[2]];
  const M: Mat3 = [c1[0], c2[0], col3[0], c1[1], c2[1], col3[1], c1[2], c2[2], col3[2]];
  const inv = invertMat3(M);
  if (!inv) return null;
  return applyH(inv, p);
}

/** Pixel size of 1 m on the ground (lateral X direction) at a ground point. Used to scale ball/stump size (0.0715 m / 0.2286 m). */
export function pxPerMeter(cam: CameraModel, X: number, Y: number, Z = 0): number {
  const a = project(cam, { x: X - 0.5, y: Y, z: Z });
  const b = project(cam, { x: X + 0.5, y: Y, z: Z });
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Expected ball diameter in pixels at world position (uses known 7.15 cm ball). */
export function expectedBallPx(cam: CameraModel, X: number, Y: number, Z: number): number {
  return pxPerMeter(cam, X, Y, Z) * 0.0715;
}

/** Expected stump width in pixels (known 22.86 cm), a scale cross-check against the homography. */
export function expectedStumpWidthPx(cam: CameraModel): number {
  return pxPerMeter(cam, 0, PITCH_LENGTH, 0) * 0.2286;
}

/** Height Z (m) above the ground point (X,Y) whose image row equals pixel v. */
export function heightFromPixelRow(cam: CameraModel, X: number, Y: number, v: number): number {
  let lo = -0.2, hi = 4.5;
  const pLo = project(cam, { x: X, y: Y, z: lo });
  const pHi = project(cam, { x: X, y: Y, z: hi });
  if (!pLo || !pHi) return 0;
  const increasing = pHi.y > pLo.y;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const pm = project(cam, { x: X, y: Y, z: mid });
    if (!pm) break;
    if ((pm.y < v) === increasing) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Pitch-corridor polygon (image space) with a lateral margin, used as the ROI mask. */
export function pitchCorridor(cam: CameraModel, margin = 0.6, yPad = 3): Pt[] {
  const hw = PITCH_WIDTH / 2 + margin;
  const pts: Pt[] = [];
  const corners: [number, number][] = [[-hw, -yPad], [hw, -yPad], [hw, PITCH_LENGTH + yPad], [-hw, PITCH_LENGTH + yPad]];
  for (const [x, y] of corners) {
    const p = project(cam, { x, y, z: 0 });
    if (p) pts.push(p);
  }
  // extend upward by 3 m so the airborne ball and bowler's arm are inside the corridor
  const hi: Pt[] = [];
  for (const [x, y] of [[hw, PITCH_LENGTH + yPad], [-hw, PITCH_LENGTH + yPad], [-hw, -yPad], [hw, -yPad]] as [number, number][]) {
    const p = project(cam, { x, y, z: 3 });
    if (p) hi.push(p);
  }
  return convexHull([...pts, ...hi]);
}

export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Camera centre in world metres (C = -Rᵀt). Its z is the camera's height above the pitch. */
export function cameraCentre(cam: CameraModel): Vec3 {
  const R = cam.R, t = cam.t;
  return { x: -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]), y: -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]), z: -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]) };
}

/** Where the pixel's ray crosses the vertical plane at distance Y along the pitch. Unlike unprojectAtHeight this stays
 *  well-conditioned when the ray is nearly level, e.g. the release point seen by a camera at about release height. */
export function unprojectAtY(cam: CameraModel, p: Pt, Y: number): Vec3 | null {
  const C = cameraCentre(cam), R = cam.R, u = (p.x - cam.cx) / cam.f, v = (p.y - cam.cy) / cam.f;
  const d = { x: R[0] * u + R[3] * v + R[6], y: R[1] * u + R[4] * v + R[7], z: R[2] * u + R[5] * v + R[8] };   // Rᵀ·[u v 1]
  if (Math.abs(d.y) < 1e-9) return null;
  const s = (Y - C.y) / d.y;
  if (s <= 0) return null;
  return { x: C.x + s * d.x, y: Y, z: C.z + s * d.z };
}
