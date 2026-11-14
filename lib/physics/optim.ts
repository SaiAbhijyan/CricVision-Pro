/** Nelder–Mead simplex minimiser (derivative-free), deterministic. */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  step: number[],
  opts: { maxIter?: number; tol?: number } = {},
): { x: number[]; fx: number; iters: number } {
  const n = x0.length;
  const maxIter = opts.maxIter ?? 400;
  const tol = opts.tol ?? 1e-9;
  let simplex: { x: number[]; f: number }[] = [{ x: [...x0], f: f(x0) }];
  for (let i = 0; i < n; i++) {
    const x = [...x0];
    x[i] += step[i] || 0.1;
    simplex.push({ x, f: f(x) });
  }
  let iters = 0;
  for (; iters < maxIter; iters++) {
    simplex.sort((a, b) => a.f - b.f);
    if (Math.abs(simplex[n].f - simplex[0].f) < tol) break;
    const cen = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) cen[k] += simplex[i].x[k] / n;
    const worst = simplex[n];
    const comb = (a: number) => cen.map((c, k) => c + a * (worst.x[k] - c));
    const xr = comb(-1), fr = f(xr);
    if (fr < simplex[0].f) {
      const xe = comb(-2), fe = f(xe);
      simplex[n] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr };
    } else if (fr < simplex[n - 1].f) {
      simplex[n] = { x: xr, f: fr };
    } else {
      const xc = fr < worst.f ? comb(-0.5) : comb(0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, worst.f)) simplex[n] = { x: xc, f: fc };
      else {
        const best = simplex[0].x;
        for (let i = 1; i <= n; i++) {
          const x = simplex[i].x.map((v, k) => best[k] + 0.5 * (v - best[k]));
          simplex[i] = { x, f: f(x) };
        }
      }
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return { x: simplex[0].x, fx: simplex[0].f, iters };
}
