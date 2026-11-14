/**
 * CricVision Pro — Fig 1: the impact-sync bench.
 * A circular frame buffer drawn as a conveyor of frame tiles, a bat-on-ball "click", a 2–5 kHz transient detector and a trigger gantry
 * that stamps the frame the sound belongs to. Every number comes from the same constants as lib/audio and lib/cv/frame-ring.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../kit/iso-kit.mjs";
import { kitScript } from "../../scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";
const WIDTH = 760, HEIGHT = 470;

// ---- model constants (mirrors lib/audio/onset-core.ts, lib/cv/frame-ring.ts) ----
const FPS = 120, SR = 48000, FRAME_MS = 1000 / FPS;            // 8.333 ms per tile
const N = 22, PITCH = 14, L = N * PITCH, X0 = -L / 2 + PITCH / 2;
const U_PER_MS = PITCH / FRAME_MS;                            // 1.68 world units per millisecond
const V = 56;                                                 // conveyor speed, units/s  (slow motion: one tile per 0.25 s)

const PLATE = { x: -200, y: -110, w: 400, d: 220, r: 8 }, PLATE_H = 12, FOOT_H = 5;
const BED = { x: -166, y: -27, w: 332, d: 54, r: 4 };
const TILE = { x: -5.5, y: -17, w: 11, d: 34, r: 1.2 }, TILE_Z = 5, TILE_H = 4;
const ANVIL = [-132, -72], MIC = [-62, -72], RACK_X = [-8, 40], DIAL = [128, -72], DIAL_R = 21, DIAL_Z = 52, DIAL_H = 10;

const P = k.fitProjection([...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [ANVIL[0], ANVIL[1], 88], [DIAL[0] + DIAL_R, DIAL[1], DIAL_Z + 40], [0, 0, 60]], WIDTH, HEIGHT, { pad: 26, azimuth: 42 });
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const rightNearer = k.depthOf([150, 0, 0], P) > k.depthOf([-150, 0, 0], P);
const backFarther = k.depthOf([0, -72, 0], P) < k.depthOf([0, 0, 0], P);
if (!rightNearer || !backFarther) throw new Error("layout assumes +x and +y are nearer the viewer");

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  const feet = k.corners(PLATE, 24).sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  for (const [x, y] of feet) { out.push(S(k.cylinder(x, y, 8, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" })); out.push(S(k.cylinder(x, y, 6, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" })); }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 11);
  out.push(Ln(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }), D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // millisecond ruler along the front edge: 1 tick = 1 ms, major = one video frame (8.33 ms)
  const strip = { x: -180, y: 86, w: 360, d: 9, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, U_PER_MS, 8, strip.y + 0.8, 0.6, [2.6, 5], P);
  out.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 4.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 4.5, 0.6])], { size: 0.45 }));
  return out.join("");
}

// ---- back row (farther): striker + anvil, microphone, band-pass rack, detector dial ----
function striker() {
  const [x, y] = ANVIL, out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: x - 22, y: y - 16, w: 44, d: 32, r: 4 }, 0, 4, P)}"/>`);
  out.push(S(k.slabOf({ x: x - 20, y: y - 14, w: 40, d: 28, r: 3 }, 0, 8, P, 4, 0.8), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 9, 8, 4, P, 32, 0.6), { tone: "hi", lit: true }));       // the ball-on-bat strike plate (the "click" source)
  out.push(Ln(k.knurl(x, y, 9, 8, 12, 30, P), { tone: "lo" }));
  out.push(D(k.corners({ x: x - 20, y: y - 14, w: 40, d: 28, r: 3 }, 4).map(([a, b]) => at([a, b, 8])), { size: 0.45 }));
  for (const px of [x - 16, x + 16]) { out.push(S(k.cylinder(px, y + 8, 2.4, 8, 74, P, 16), { tone: "mid", crease: "none" })); out.push(S(k.cylinder(px, y + 8, 3.4, 82, 3, P, 20), { tone: "mid" })); }
  out.push(S(k.slabOf({ x: x - 19, y: y + 5, w: 38, d: 6, r: 1.5 }, 82, 6, P, 3, 0.5), { tone: "mid" }));   // top bridge
  return out.join("");
}
const hammer = () => S(k.cylinder(ANVIL[0], ANVIL[1], 5, 0, 7, P, 24, 0.5), { tone: "hi", lit: true }) + S(k.cylinder(ANVIL[0], ANVIL[1], 1.6, 7, 26, P, 12), { tone: "hi", lit: true, crease: "none" });

function mic() {
  const [x, y] = MIC, out = [];
  out.push(S(k.cylinder(x, y, 12, 0, 3, P, 40, 0.6), { tone: "mid" }), S(k.cylinder(x, y, 3, 3, 40, P, 20), { tone: "mid", crease: "none" }));
  out.push(Ln([14, 26].map((z) => k.sideArc(x, y, 3, z, P, 10)).join(""), { tone: "faint" }));
  out.push(S(k.slabOf({ x: x - 5, y: y - 5, w: 10, d: 10, r: 2 }, 40, 6, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 7, 46, 18, P, 36, 0.7), { tone: "hi" }));                    // capsule
  out.push(Ln(k.knurl(x, y, 7, 46, 64, 28, P, 0.2), { tone: "lo" }), Ln(k.sideArc(x, y, 7, 55, P, 28), { tone: "faint" }));
  out.push(S(k.cylinder(x, y, 5, 64, 3, P, 28, 0.4), { tone: "mid" }), Ln(k.ring(x, y, 3, 67, P, 20), { tone: "lo" }));
  return out.join("");
}

function rack() {
  // five band plates standing like a comb: 1 kHz is cut short (blocked), 2–5 kHz stand tall and lit (the pass band)
  const out = [], base = { x: RACK_X[0] - 10, y: -86, w: RACK_X[1] - RACK_X[0] + 20, d: 28, r: 3 };
  out.push(`<path class="iso-halo" d="${k.haloOf(base, 0, 5, P)}"/>`);
  out.push(S(k.slabOf(base, 0, 5, P, 4, 0.7), { tone: "mid" }));
  out.push(D(k.corners(base, 4).map(([a, b]) => at([a, b, 5])), { size: 0.4 }));
  const hs = [8, 28, 38, 38, 28];
  hs.forEach((h, i) => {
    const px = RACK_X[0] + i * 12;
    out.push(S(k.slabOf({ x: px - 2, y: -82, w: 4, d: 20, r: 1 }, 5, h, P, 2, 0.4), i === 0 ? { tone: "lo" } : { tone: "hi", lit: i > 0 }));
    out.push(Ln(k.lineOnTop([px - 2, -78], [px + 2, -78], 5 + h, P), { tone: i === 0 ? "faint" : "lo" }));
  });
  out.push(k.faceTextSvg(k.topMatrix([RACK_X[0] + 24, -63], 5, P, "x"), "HP 2k · LP 5k", { size: 3, tone: "lo", anchor: "middle" }));
  return out.join("");
}

function dialBody() {
  const [x, y] = DIAL, out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: x - 24, y: y - 18, w: 48, d: 36, r: 4 }, 0, 4, P)}"/>`);
  out.push(S(k.slabOf({ x: x - 26, y: y - 18, w: 52, d: 36, r: 4 }, 0, 6, P, 4, 0.8), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 4, 6, DIAL_Z - 6, P, 20), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, DIAL_R, DIAL_Z, DIAL_H, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  out.push(Ln(k.knurl(x, y, DIAL_R, DIAL_Z + DIAL_H - 3.4, DIAL_Z + DIAL_H, 84, P, 0.3), { tone: "lo" }), Ln(k.ring(x, y, DIAL_R - 2.2, DIAL_Z + DIAL_H, P, 64), { tone: "lo" }));
  const t = k.radialTicks(x, y, DIAL_R - 3, 40, 5, DIAL_Z + DIAL_H, [1.3, 2.8], P, -Math.PI * 0.75, Math.PI * 1.5);
  out.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
  out.push(Ln(k.ring(x, y, 1.6, DIAL_Z + DIAL_H, P, 16), { tone: "mid" }));
  out.push(k.faceTextSvg(k.topMatrix([x, y + 10], DIAL_Z + DIAL_H, P, "x"), "onset", { size: 2.6, tone: "lo", anchor: "middle" }));
  return out.join("");
}
const THRESH = 0.35;
const ang = (e) => -Math.PI * 0.75 + e * Math.PI * 1.5;
const needleAt = (e) => { const a = ang(e), [x, y] = DIAL, z = DIAL_Z + DIAL_H + 0.2; return k.lineOnTop([x - Math.sin(a) * 3.4, y + Math.cos(a) * 3.4], [x + Math.sin(a) * (DIAL_R - 4), y - Math.cos(a) * (DIAL_R - 4)], z, P); };
const threshMark = () => { const a = ang(THRESH), [x, y] = DIAL, z = DIAL_Z + DIAL_H + 0.2; return k.lineOnTop([x + Math.sin(a) * (DIAL_R - 6.4), y - Math.cos(a) * (DIAL_R - 6.4)], [x + Math.sin(a) * (DIAL_R - 1.4), y - Math.cos(a) * (DIAL_R - 1.4)], z, P); };

// ---- conveyor: bed, rails, tiles ----
function bed() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BED, 0, 5, P)}"/>`];
  out.push(S(k.slabOf(BED, 0, 5, P, 5, 0.8), { tone: "mid" }));
  out.push(Ln(k.planOutline(k.insetPlan(BED, 3), 5, P), { tone: "faint" }));
  // gate groove (frame-time zero) and the ±2 ms window
  const g = (x, tone) => Ln(k.lineOnTop([x, -22], [x, 22], 5, P), { tone });
  out.push(g(0, "hi"), g(-2 * U_PER_MS, "lo"), g(2 * U_PER_MS, "lo"));
  out.push(D(k.corners(BED, 5).map(([a, b]) => at([a, b, 5])), { size: 0.45 }));
  return out.join("");
}
const railBack = () => S(k.slabOf({ x: BED.x, y: -27, w: BED.w, d: 5, r: 1 }, 5, 8, P, 3, 0.5), { tone: "mid" }) + D([-140, -60, 60, 140].map((x) => at([x, -24.5, 13])), { size: 0.4 });
const railFront = () => S(k.slabOf({ x: BED.x, y: 22, w: BED.w, d: 5, r: 1 }, 5, 8, P, 3, 0.5), { tone: "mid" }) + D([-140, -60, 60, 140].map((x) => at([x, 24.5, 13])), { size: 0.4 });

const tilePaths = (lit) => {
  const o = [S(k.slabOf(TILE, TILE_Z, TILE_H, P, 3, 0.4), lit ? { tone: "hi", lit: true } : { tone: "hi", crease: "lo" })];
  const z = TILE_Z + TILE_H;
  o.push(Ln(k.planOutline(k.insetPlan(TILE, 2), z, P, 2), { tone: lit ? "mid" : "faint" }));
  o.push(Ln(k.lineOnTop([0, -15], [0, 15], z, P), { tone: "mid" }));                                   // frame timestamp (tile centre)
  o.push(Ln([-2, 2].map((m) => k.lineOnTop([m * U_PER_MS, -15], [m * U_PER_MS, -10.5], z, P) + k.lineOnTop([m * U_PER_MS, 15], [m * U_PER_MS, 10.5], z, P)).join(""), { tone: "lo" })); // ±2 ms ticks hang from the frame edge
  return o.join("");
};
const flagPaths = () => S(k.slabOf({ x: -0.6, y: -15, w: 1.2, d: 1.2, r: 0.3 }, TILE_Z + TILE_H, 17, P, 2), { tone: "hi", lit: true }) + S(k.slabOf({ x: 0.6, y: -15, w: 0.8, d: 8, r: 0.3 }, TILE_Z + TILE_H + 10, 7, P, 2), { tone: "hi", lit: true });
const pipPaths = () => S(k.cylinder(0, 0, 1.8, TILE_Z + TILE_H, 1.2, P, 16), { tone: "hi", lit: true });
const tileGroups = Array.from({ length: N }, (_, j) => `<g data-tile="${j}"><g data-v="n">${tilePaths(false)}</g><g data-v="l" style="display:none">${tilePaths(true)}</g><g data-flag style="display:none">${flagPaths()}</g><g data-pip style="display:none">${pipPaths()}</g></g>`).join("");

function camera() {
  // frame source (left, far end): lens barrel pushing (t, ImageBitmap) into the ring
  const out = [], cx = -190, plan = { x: cx - 10, y: -22, w: 22, d: 44, r: 3 };
  out.push(S(k.slabOf(plan, 0, 20, P, 4, 0.8), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(plan, 3), 20, 6, P, 4, 0.6), { tone: "mid" }));
  out.push(S(k.cylinder(cx + 12, 0, 9, 4, 14, P, 36, 0.6), { tone: "hi" }), Ln(k.ring(cx + 12, 0, 6, 18, P, 28), { tone: "lo" }), D([at([cx + 12, 0, 18])], { size: 1.2, tone: "hi" }));
  out.push(D(k.corners(plan, 3).map(([a, b]) => at([a, b, 26])), { size: 0.4 }));
  return out.join("");
}
function bin() {
  // drawer on the near end: evicted frames are closed (ImageBitmap.close())
  const out = [], plan = { x: 170, y: -26, w: 24, d: 52, r: 3 };
  out.push(S(k.slabOf(plan, 0, 14, P, 4, 0.8), { tone: "mid" }), S(k.slabOf(k.insetPlan(plan, 3), 14, 3, P, 3, 0.5), { tone: "lo" }));
  out.push(Ln(k.planOutline(k.insetPlan(plan, 6), 17, P, 3), { tone: "faint" }), D(k.corners(plan, 4).map(([a, b]) => at([a, b, 14])), { size: 0.4 }));
  out.push(S(k.slabOf({ x: 178, y: 30, w: 8, d: 5, r: 1.2 }, 0, 6, P, 2), { tone: "mid" }));   // drawer pull
  return out.join("");
}

function gantry() {
  const out = [], rails = [];
  // two rails along x just outside the bed carry the gantry; gantry itself is drawn at x = 0 and moved with translateAlong
  for (const y of [-34, 30]) rails.push(S(k.slabOf({ x: -170, y, w: 340, d: 4, r: 1 }, 0, 3, P, 2, 0.3), { tone: "lo" }));
  const post = (y) => S(k.slabOf({ x: -6, y: y - 3, w: 12, d: 6, r: 1.5 }, 3, 42, P, 3, 0.5), { tone: "mid" }) + D([at([0, y, 45])], { size: 0.45 });
  const bar = S(k.slabOf({ x: -7, y: -34, w: 14, d: 68, r: 2 }, 40, 6, P, 3, 0.6), { tone: "mid" });
  const sol = S(k.slabOf({ x: -6, y: -9, w: 12, d: 18, r: 2 }, 46, 12, P, 3, 0.6), { tone: "hi" });
  return { rails: rails.join(""), back: post(-32), bar: bar + sol, front: post(32) };
}
const pin = () => S(k.cylinder(0, 0, 1.4, 30, 20, P, 14), { tone: "hi", lit: true, crease: "none" }) + S(k.cylinder(0, 0, 2.2, 28, 2, P, 14), { tone: "hi", lit: true });

const G = gantry();
const body = [
  `<g data-rings></g>`,
  base(), striker(), `<g data-part="hammer" transform="${k.translateAlong(P, [0, 0, 30])}">${hammer()}</g>`, mic(), rack(), dialBody(),
  `<path data-part="thresh" class="iso-line" data-tone="mid" data-free="start" d="${threshMark()}" style="stroke-width:1.4"/>`,
  `<path data-part="needle" class="iso-line" data-tone="lit" data-free="start" d="${needleAt(0.04)}" style="stroke-width:1.1"/>`,
  camera(), bed(), railBack(),
  G.rails, `<g data-part="gantry-back" transform="${k.translateAlong(P, [0, 0, 0])}">${G.back}</g>`,
  `<g data-tiles>${tileGroups}</g>`,
  `<g data-part="gantry" transform="${k.translateAlong(P, [0, 0, 0])}">${G.bar}<g data-part="pin" transform="${k.translateAlong(P, [0, 0, 0])}">${pin()}</g></g>`,
  `<g data-part="gantry-front" transform="${k.translateAlong(P, [0, 0, 0])}">${G.front}</g>`,
  railFront(), bin(),
  // signal wires run flat on the plate: mic -> band-pass comb -> detector dial -> rail contact that feeds the gantry solenoid
  k.wireSvg(at([MIC[0] + 12, MIC[1], 3]), at([RACK_X[0] - 12, -76, 5]), { via: [at([MIC[0] + 22, -76, 0.3])], tone: "lo", ends: "both", size: 1 }),
  k.wireSvg(at([RACK_X[1] + 12, -76, 5]), at([DIAL[0] - 26, DIAL[1], 6]), { via: [at([RACK_X[1] + 22, -76, 0.3]), at([DIAL[0] - 34, -72, 0.3])], tone: "lo", ends: "both", size: 1 }),
  k.wireSvg(at([DIAL[0] + 26, DIAL[1] + 4, 6]), at([176, -34, 3]), { via: [at([DIAL[0] + 40, -72, 0.3]), at([176, -50, 0.3])], tone: "lit", ends: "both", size: 1.1 }),
];

const svg = k.figureSvg({
  width: WIDTH, height: HEIGHT, body,
  label: "The impact-sync bench. A conveyor of 22 frame tiles is a circular video buffer: a camera pushes a new frame in at the far end and the oldest frame is evicted at the near end. Behind it, a striker hits an anvil; a microphone, a 2 to 5 kilohertz band-pass comb and a threshold dial detect the click. A gantry then rides back along the conveyor to stamp the exact frame the click belongs to and pulls a clip window around it.",
});

const keys = [
  { mark: "raised", label: "Frame tiles: the circular buffer (22 here, 6 s at 30 fps in the app)" },
  { mark: "lit", label: "Lit parts: the click, the needle and the stamped frame + clip window" },
  { mark: "dim", label: "Rulers: 1 tick = 1 ms, tall tick = one 120 fps frame (8.33 ms)" },
];
const html = k.plateHtml({
  fig: "Fig 1", title: "Impact sync bench", hint: "Hover to restart the click", readout: "listening · mic floor 0.004",
  keys,
  caption: "How CricVision locks the sound of bat on ball to a video frame. Frames flow through a ring buffer (camera pushes, oldest is closed). The click hits the microphone, the 2–5 kHz band-pass lets the crack through and blocks the thud, and when the envelope crosses 8× the noise floor the detector reports the onset to the exact audio sample (1/48 000 s). The gantry then travels back in time to the frame nearest that sample and stamps it; the pip shows how far inside the ±2 ms window the impact fell, and the lit tiles are the clip window saved to IndexedDB.",
  body: `<div class="iso-stage" tabindex="0" role="img" aria-label="Impact sync bench">${svg}</div>`,
});

const live = `
const P = ${JSON.stringify(P)};
const N = ${N}, PITCH = ${PITCH}, L = ${L}, X0 = ${X0}, V = ${V}, U_PER_MS = ${U_PER_MS}, FRAME_MS = ${FRAME_MS}, SR = ${SR}, FPS = ${FPS};
const ANVIL = ${JSON.stringify(ANVIL)}, MIC = ${JSON.stringify(MIC)}, DIAL = ${JSON.stringify(DIAL)}, DIAL_R = ${DIAL_R}, DIAL_TOP = ${DIAL_Z + DIAL_H}, THRESH = ${THRESH};
const stage = document.querySelector(".iso-stage"), svg = stage.querySelector("svg"), readout = document.querySelector("[data-readout]");
const tiles = [...svg.querySelectorAll("[data-tile]")], tileBox = svg.querySelector("[data-tiles]");
const hammer = svg.querySelector('[data-part="hammer"]'), needle = svg.querySelector('[data-part="needle"]'), rings = svg.querySelector("[data-rings]");
const gantryParts = ["gantry-back", "gantry", "gantry-front"].map((n) => svg.querySelector('[data-part="' + n + '"]'));
const pin = svg.querySelector('[data-part="pin"]');
const still = matchMedia("(prefers-reduced-motion: reduce)");
const FRACS = [0.31, 0.74, 0.52, 0.18, 0.9];
const PERIOD = 9, T_WIND = 1.2, WAVE_V = 90, MIC_DIST = Math.hypot(MIC[0] - ANVIL[0], MIC[1] - ANVIL[1]);
const DIAL_Z = ${DIAL_Z}, DIAL_H = ${DIAL_H};
const ang = ${ang.toString()};
const needleAt = ${needleAt.toString().replace(/k\./g, "")};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let clock = 0, last = 0, visible = false, frame = 0, loops = 0, started = performance.now();
const tilePos = (j, s) => X0 + ((j * PITCH + s) % L + L) % L;
function plan(loop) {
  const tHit = 3.0 + FRACS[loop % FRACS.length] * (PITCH / V);
  const tMic = tHit + MIC_DIST / WAVE_V, tFire = tMic + 0.05;
  return { tHit, tMic, tFire, tStamp: tFire + 0.75 };
}
function draw(t, loop) {
  const pl = plan(loop), s = V * t, sHit = V * pl.tHit;
  // conveyor
  const order = [];
  tiles.forEach((el, j) => { const x = tilePos(j, s); order.push([x, el]); el.setAttribute("transform", translateAlong(P, [x, 0, 0])); });
  order.sort((a, b) => a[0] - b[0]).forEach(([, el]) => tileBox.appendChild(el));
  // which tile was nearest the gate at the hit?
  let hitJ = 0, best = 1e9, hitDx = 0;
  tiles.forEach((el, j) => { const x = tilePos(j, sHit); if (Math.abs(x) < best) { best = Math.abs(x); hitJ = j; hitDx = x; } });
  const stamped = t >= pl.tStamp, residualMs = -hitDx / U_PER_MS;   // impact time minus frame time, ms (positive = impact after the frame)
  tiles.forEach((el, j) => {
    const mine = j === hitJ && t >= pl.tFire;
    const dj = ((tilePos(j, s) - tilePos(hitJ, s)) / PITCH);
    const inWindow = stamped && Math.abs(dj) <= 3.01;
    el.querySelector('[data-v="n"]').style.display = inWindow ? "none" : "";
    el.querySelector('[data-v="l"]').style.display = inWindow ? "" : "none";
    el.querySelector("[data-flag]").style.display = stamped && j === hitJ ? "" : "none";
    const pip = el.querySelector("[data-pip]"); pip.style.display = stamped && j === hitJ ? "" : "none";
    if (stamped && j === hitJ) pip.setAttribute("transform", translateAlong(P, [-hitDx, 0, 0]));
  });
  // striker: wind up, drop, rebound
  const drop = smooth(T_WIND, pl.tHit, t);
  hammer.setAttribute("transform", translateAlong(P, [0, 0, t < pl.tHit ? 30 * (1 - drop * drop) : 30 * smooth(pl.tHit, pl.tHit + 0.6, t)]));
  // sound rings spreading over the floor from the anvil, fading before they reach the plate edge
  let r = "";
  for (let i = 0; i < 3; i++) { const age = t - pl.tHit - i * 0.28; if (age < 0) continue; const rad = age * WAVE_V; if (rad > MIC_DIST + 26) continue; const a = 0.9 * (1 - rad / (MIC_DIST + 26)); r += '<path class="iso-line" data-tone="lit" opacity="' + a.toFixed(2) + '" d="' + ring(ANVIL[0], ANVIL[1], rad, 0.2, P, 56) + '"/>'; }
  rings.innerHTML = r;
  // envelope on the needle: noise floor, then the click, then decay
  const env = 0.04 + 0.9 * smooth(pl.tMic, pl.tMic + 0.09, t) * (1 - smooth(pl.tMic + 0.12, pl.tMic + 0.7, t));
  needle.setAttribute("d", needleAt(env));
  // gantry rides back along the conveyor to the earlier frame, drops its pin, then returns
  const target = tilePos(hitJ, s);
  const slew = smooth(pl.tFire, pl.tFire + 0.45, t) * (1 - smooth(pl.tStamp + 0.6, pl.tStamp + 1.3, t));
  const gx = slew * target;
  gantryParts.forEach((g) => g.setAttribute("transform", translateAlong(P, [gx, 0, 0])));
  const pz = -22 * smooth(pl.tFire + 0.5, pl.tStamp, t) * (1 - smooth(pl.tStamp + 0.1, pl.tStamp + 0.45, t));
  pin.setAttribute("transform", translateAlong(P, [0, 0, pz]));
  // readout
  let text;
  const fno = Math.floor(s / PITCH) + 100 - Math.floor((tilePos(hitJ, s) - X0) / PITCH);
  if (t < pl.tMic) text = "listening · mic floor 0.004";
  else if (t < pl.tStamp) text = "onset · sample " + Math.round(pl.tHit * SR) + " · 0.02 ms resolution";
  else text = "frame #" + (Math.floor(sHit / PITCH) + 100 - Math.floor((tilePos(hitJ, sHit) - X0) / PITCH)) + " · residual " + (residualMs >= 0 ? "+" : "") + residualMs.toFixed(1) + " ms";
  if (readout.textContent !== text) readout.textContent = text;
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60; last = now;
  clock += dt; if (clock > PERIOD) { clock -= PERIOD; loops++; }
  draw(clock, loops);
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointerenter", () => { clock = 0; loops++; run(); });
stage.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); clock = 0; loops++; run(); } });
if (still.matches) { clock = plan(0).tStamp + 0.4; draw(clock, 0); visible = false; } else draw(0, 0);
`;
const out = theme === "light" ? "cv-sync-light.html" : "cv-sync.html";
writeFileSync(join(HERE, out), k.pageHtml({ title: "Impact sync bench", theme, body: html, script: kitScript() + live, width: 820 }));
console.log("wrote", out);
