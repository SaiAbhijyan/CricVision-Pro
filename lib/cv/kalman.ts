/**
 * Constant-acceleration 2D Kalman filter with position + (optional) optical-flow velocity measurements.
 * State: [x, y, vx, vy, ax, ay].  Minimal dense matrix maths (6x6) – no dependencies.
 */
type M = number[][];
const zeros = (r: number, c: number): M => Array.from({ length: r }, () => new Array<number>(c).fill(0));
const eye = (n: number): M => { const m = zeros(n, n); for (let i = 0; i < n; i++) m[i][i] = 1; return m; };
const mul = (a: M, b: M): M => {
  const r = zeros(a.length, b[0].length);
  for (let i = 0; i < a.length; i++) for (let k = 0; k < b.length; k++) { const aik = a[i][k]; if (aik === 0) continue; for (let j = 0; j < b[0].length; j++) r[i][j] += aik * b[k][j]; }
  return r;
};
const T = (a: M): M => a[0].map((_, j) => a.map((r) => r[j]));
const add = (a: M, b: M): M => a.map((r, i) => r.map((v, j) => v + b[i][j]));
const sub = (a: M, b: M): M => a.map((r, i) => r.map((v, j) => v - b[i][j]));

function inv(a: M): M {
  const n = a.length;
  const m = a.map((r, i) => [...r, ...eye(n)[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-14) throw new Error("singular");
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c]; if (f !== 0) for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j]; }
  }
  return m.map((r) => r.slice(n));
}

export interface KalmanOptions {
  /** process noise for acceleration (px/s^2)^2 */
  qAcc?: number;
  /** position measurement std (px) */
  rPos?: number;
  /** velocity measurement std (px/s) from optical flow */
  rVel?: number;
}

export class BallKalman {
  x: number[];
  P: M;
  t: number;
  private readonly q: number;
  private readonly rp: number;
  private readonly rv: number;

  constructor(x: number, y: number, t: number, vx = 0, vy = 0, o: KalmanOptions = {}) {
    this.x = [x, y, vx, vy, 0, 0];
    this.P = zeros(6, 6);
    const p0 = [4, 4, 4e4, 4e4, 4e5, 4e5];
    for (let i = 0; i < 6; i++) this.P[i][i] = p0[i];
    this.t = t;
    this.q = o.qAcc ?? 4e5;
    this.rp = (o.rPos ?? 1.5) ** 2;
    this.rv = (o.rVel ?? 120) ** 2;
  }

  predict(t: number): void {
    const dt = Math.max(1e-4, t - this.t);
    const F = eye(6);
    F[0][2] = dt; F[1][3] = dt; F[2][4] = dt; F[3][5] = dt;
    F[0][4] = 0.5 * dt * dt; F[1][5] = 0.5 * dt * dt;
    const x = this.x;
    this.x = [
      x[0] + x[2] * dt + 0.5 * x[4] * dt * dt,
      x[1] + x[3] * dt + 0.5 * x[5] * dt * dt,
      x[2] + x[4] * dt, x[3] + x[5] * dt, x[4], x[5],
    ];
    // piecewise-white-noise acceleration model
    const Q = zeros(6, 6);
    const dt2 = dt * dt, dt3 = dt2 * dt, dt4 = dt3 * dt;
    for (const o of [0, 1]) {
      Q[o][o] = (dt4 / 4) * this.q; Q[o][o + 2] = (dt3 / 2) * this.q; Q[o][o + 4] = (dt2 / 2) * this.q;
      Q[o + 2][o] = (dt3 / 2) * this.q; Q[o + 2][o + 2] = dt2 * this.q; Q[o + 2][o + 4] = dt * this.q;
      Q[o + 4][o] = (dt2 / 2) * this.q; Q[o + 4][o + 2] = dt * this.q; Q[o + 4][o + 4] = this.q;
    }
    this.P = add(mul(mul(F, this.P), T(F)), Q);
    this.t = t;
  }

  /** Update with a position measurement and optionally a velocity measurement (optical flow). */
  update(zx: number, zy: number, flow?: { vx: number; vy: number } | null): void {
    const useV = !!flow;
    const m = useV ? 4 : 2;
    const H = zeros(m, 6);
    H[0][0] = 1; H[1][1] = 1;
    if (useV) { H[2][2] = 1; H[3][3] = 1; }
    const R = zeros(m, m);
    R[0][0] = this.rp; R[1][1] = this.rp;
    if (useV) { R[2][2] = this.rv; R[3][3] = this.rv; }
    const z = [[zx], [zy]];
    if (useV && flow) { z.push([flow.vx]); z.push([flow.vy]); }
    const xm = this.x.map((v) => [v]);
    const y = sub(z, mul(H, xm));
    const S = add(mul(mul(H, this.P), T(H)), R);
    const K = mul(mul(this.P, T(H)), inv(S));
    const dx = mul(K, y);
    this.x = this.x.map((v, i) => v + dx[i][0]);
    this.P = mul(sub(eye(6), mul(K, H)), this.P);
  }

  /** Mahalanobis distance² of a candidate position against the predicted state */
  gate(zx: number, zy: number): number {
    const sxx = this.P[0][0] + this.rp, syy = this.P[1][1] + this.rp, sxy = this.P[0][1];
    const det = sxx * syy - sxy * sxy;
    const dx = zx - this.x[0], dy = zy - this.x[1];
    return (syy * dx * dx - 2 * sxy * dx * dy + sxx * dy * dy) / (det || 1e-9);
  }

  get pos() { return { x: this.x[0], y: this.x[1] }; }
  get vel() { return { vx: this.x[2], vy: this.x[3] }; }
}
