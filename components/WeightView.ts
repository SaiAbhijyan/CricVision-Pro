import type { ClipMeta } from "@/lib/types";
import { BONES, JOINTS } from "@/lib/cv/skeleton";

const GROUPS: [string, number[]][] = [
  ["Head", [0]], ["Trunk", [1]], ["Arms", [2, 3, 4, 8, 9, 10]], ["Thighs", [5, 11]], ["Shanks", [6, 12]], ["Feet", [7, 13]],
];
export const WV_W = 1280, WV_H = 720;

/**
 * Side-on body-weight view. Every body segment is drawn as a bubble sized by its share of body mass; their weighted centre is the
 * centre of gravity, dropped to the ground and read against the base of support between the feet. `scan` (0..1) sweeps a line from
 * head to toe and counts the mass it passes; null draws the live frame.
 */
export function drawWeightView(g: CanvasRenderingContext2D, clip: ClipMeta, i: number, scan: number | null) {
  const W = WV_W, H = WV_H, GROUND = 610, S = 320;
  g.clearRect(0, 0, W, H);
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#0b1a12"); bg.addColorStop(1, "#050d09");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const first = clip.overlays.find((o) => o.com)?.com;
  const ov = clip.overlays[i];
  const cm = ov?.com ?? clip.overlays.slice(0, i + 1).reverse().find((o) => o.com)?.com;
  if (!first || !cm) { g.fillStyle = "#ffffff88"; g.font = "bold 26px system-ui"; g.fillText("Batter not in frame", 40, 60); return; }
  const cy0 = first.side.c[0], X0 = W * 0.30;
  const px = (y: number) => X0 + (cy0 - y) * S, pz = (z: number) => GROUND - z * S;
  const sd = cm.side;

  // ground, crease
  g.fillStyle = "#16301f"; g.fillRect(0, GROUND, W, H - GROUND);
  g.strokeStyle = "#ffffff55"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, GROUND); g.lineTo(W, GROUND); g.stroke();
  const cr = px(20.12 - 1.22); g.strokeStyle = "#ffffff99"; g.lineWidth = 3; g.beginPath(); g.moveTo(cr, GROUND - 6); g.lineTo(cr, GROUND + 60); g.stroke();
  g.fillStyle = "#ffffff77"; g.font = "600 17px system-ui"; g.fillText("BATTING CREASE", cr + 8, GROUND + 92);
  g.fillStyle = "#ffffff55"; g.font = "600 18px system-ui"; g.fillText("BOWLER  ▶", W * 0.62, GROUND + 112);

  const zTop = Math.max(...sd.j.filter((_, k) => k % 2 === 1)) + 0.08;
  const zScan = scan === null ? -1 : zTop * (1 - scan);
  const counted = (k: number) => scan === null || sd.seg[k * 3 + 1] >= zScan;

  // bones
  g.lineCap = "round";
  g.strokeStyle = "#b6ff3c"; g.lineWidth = 6;
  for (const [a, b] of BONES) {
    const ia = JOINTS.indexOf(a), ib = JOINTS.indexOf(b);
    g.beginPath(); g.moveTo(px(sd.j[ia * 2]), pz(sd.j[ia * 2 + 1])); g.lineTo(px(sd.j[ib * 2]), pz(sd.j[ib * 2 + 1])); g.stroke();
  }
  g.fillStyle = "#e8ffb8"; for (let k = 0; k < JOINTS.length; k++) { g.beginPath(); g.arc(px(sd.j[k * 2]), pz(sd.j[k * 2 + 1]), 5, 0, 7); g.fill(); }

  // mass bubbles, one per segment
  let mass = 0;
  for (let k = 0; k < 14; k++) {
    const y = sd.seg[k * 3], z = sd.seg[k * 3 + 1], w = sd.seg[k * 3 + 2], on = counted(k);
    if (on) mass += w;
    g.fillStyle = on ? "rgba(255,179,71,.30)" : "rgba(255,179,71,.05)"; g.strokeStyle = on ? "rgba(255,179,71,.95)" : "rgba(255,179,71,.18)"; g.lineWidth = 2;
    g.beginPath(); g.arc(px(y), pz(z), Math.sqrt(w) * 150, 0, 7); g.fill(); g.stroke();
  }

  // base of support
  const bx = px(sd.b), fx = px(sd.f), by = GROUND + 22;
  g.fillStyle = "rgba(255,255,255,.10)"; g.fillRect(Math.min(bx, fx), GROUND + 4, Math.abs(fx - bx), 36);
  g.strokeStyle = "#fff"; g.lineWidth = 6; g.beginPath(); g.moveTo(bx, by); g.lineTo(fx, by); g.stroke();
  for (const [x, c, t] of [[bx, "#6ee7ff", "BACK FOOT"], [fx, "#b6ff3c", "FRONT FOOT"]] as const) {
    g.fillStyle = c; g.beginPath(); g.arc(x, by, 9, 0, 7); g.fill();
    const left = x <= Math.min(bx, fx) + 0.5 && Math.abs(bx - fx) > 2 ? x === Math.min(bx, fx) : true;
    g.font = "700 18px system-ui"; g.textAlign = x === Math.min(bx, fx) ? "right" : "left"; g.fillText(t, x + (x === Math.min(bx, fx) ? -16 : 16), by + 7); g.textAlign = "left"; void left;
  }

  const showCom = scan === null || scan > 0.97;
  if (showCom) {
    // path of the centre of gravity so far
    g.strokeStyle = "#ffb347"; g.lineWidth = 4; g.shadowColor = "#ffb347"; g.shadowBlur = 12; g.beginPath(); let st = false;
    for (let k = 0; k <= i; k++) { const o = clip.overlays[k]?.com; if (!o) continue; const x = px(o.side.c[0]), y = pz(o.side.c[1]); if (!st) { g.moveTo(x, y); st = true; } else g.lineTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
    const cx = px(sd.c[0]), cz = pz(sd.c[1]), gx = cx;
    g.setLineDash([9, 7]); g.strokeStyle = "#ffb347"; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cz); g.lineTo(gx, GROUND); g.stroke(); g.setLineDash([]);
    g.fillStyle = "#ffb347"; g.beginPath(); g.moveTo(gx, GROUND - 2); g.lineTo(gx - 12, GROUND - 22); g.lineTo(gx + 12, GROUND - 22); g.closePath(); g.fill();
    g.strokeStyle = "#fff"; g.lineWidth = 4; g.beginPath(); g.arc(cx, cz, 15, 0, 7); g.moveTo(cx - 24, cz); g.lineTo(cx + 24, cz); g.moveTo(cx, cz - 24); g.lineTo(cx, cz + 24); g.stroke();
    g.fillStyle = "#fff"; g.font = "700 19px system-ui"; g.fillText("CENTRE OF GRAVITY", cx + 30, cz - 14);
  }

  // scan line
  if (scan !== null && scan < 1) {
    const zy = pz(zScan);
    g.strokeStyle = "#6ee7ff"; g.lineWidth = 3; g.shadowColor = "#6ee7ff"; g.shadowBlur = 16; g.beginPath(); g.moveTo(40, zy); g.lineTo(W - 40, zy); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = "#6ee7ff"; g.font = "700 20px system-ui"; g.fillText(`${(Math.max(0, zScan) * 100).toFixed(0)} cm`, 48, zy - 10);
  }

  // weight meter
  const pct = cm.pct, mx = W - 470, my = 50, mw = 430, mh = 34;
  g.fillStyle = "#6ee7ff"; g.fillRect(mx, my, mw * (1 - pct / 100), mh); g.fillStyle = "#b6ff3c"; g.fillRect(mx + mw * (1 - pct / 100), my, mw * (pct / 100), mh);
  g.strokeStyle = "#ffffffaa"; g.lineWidth = 2; g.strokeRect(mx, my, mw, mh);
  g.fillStyle = "#fff"; g.font = "800 30px system-ui";
  if (scan !== null && scan < 0.97) g.fillText(`Mass counted ${(mass * 100).toFixed(0)}%`, mx, my + mh + 44);
  else g.fillText(`${(100 - pct).toFixed(0)}% back  ·  ${pct.toFixed(0)}% front`, mx, my + mh + 44);
  g.font = "600 20px system-ui"; g.fillStyle = "#ffffffcc";
  if (scan === null) g.fillText(`Centre of gravity moving ${cm.fwd >= 0 ? "forward" : "back"} at ${Math.abs(cm.fwd).toFixed(1)} m/s`, mx, my + mh + 78);
  else g.fillText("Every segment weighed, head to toe", mx, my + mh + 78);

  // mass table
  const tx = W - 470, ty = 250;
  g.fillStyle = "#ffffff99"; g.font = "700 17px system-ui"; g.fillText("BODY MASS, HEAD TO TOE", tx, ty);
  GROUPS.forEach(([name, ids], r) => {
    const w = ids.reduce((a, k) => a + sd.seg[k * 3 + 2], 0), y = ty + 40 + r * 44;
    g.fillStyle = "#ffffffdd"; g.font = "600 21px system-ui"; g.fillText(name, tx, y);
    g.fillStyle = "rgba(255,179,71,.85)"; g.fillRect(tx + 100, y - 17, w * 480, 18);
    g.fillStyle = "#fff"; g.fillText(`${(w * 100).toFixed(1)}%`, tx + 110 + w * 480, y);
  });
  g.fillStyle = "#ffffffaa"; g.font = "600 16px system-ui"; g.fillText(`SIDE VIEW · Ball ${clip.ballIndex} · t=${(ov?.t ?? 0).toFixed(2)}s`, 40, H - 24);
}
