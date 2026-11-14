export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = (r: Rng) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
export const pick = <T,>(r: Rng, xs: T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
export const between = (r: Rng, a: number, b: number) => a + (b - a) * r();
export function weighted<T>(r: Rng, items: [T, number][]): T {
  const tot = items.reduce((s, i) => s + i[1], 0);
  let x = r() * tot;
  for (const [v, w] of items) { x -= w; if (x <= 0) return v; }
  return items[items.length - 1][0];
}
