import type { Calibration, Pt } from "@/lib/types";
import { PITCH_LENGTH, STUMP_HEIGHT, rad } from "@/lib/physics/constants";
import { WORLD_CORNERS } from "@/lib/physics/homography";

/**
 * Nominal broadcast-style camera behind the batter's stumps (screen-right = +X) used by the simulator,
 * the calibration UI's default marker layout and the replay renderer.
 */
/** `rig`: tripod distance behind the stumps (m), height (m) and focal length as a share of image width. Defaults are the
 *  original test rig; { dist: 4, height: 1.3, focal: 0.73 } is a phone main camera on Fulltrack's recommended tripod. */
export function virtualCalibration(w = 1280, h = 720, end: "batter" | "bowler" = "batter", rig: { dist?: number; height?: number; focal?: number } = {}): Calibration {
  const f = (rig.focal ?? 0.95) * w;
  const dist = rig.dist ?? 4.5, height = rig.height ?? 2.4;
  const th = Math.atan2(height, dist + PITCH_LENGTH / 2);
  const s = Math.sin(th), c = Math.cos(th);
  const sgn = end === "batter" ? 1 : -1;
  const C = { x: 0, y: end === "batter" ? PITCH_LENGTH + dist : -dist, z: height };
  // camera axes in world coordinates (rows of M): x_c (screen right), y_c (screen down), z_c (forward)
  const xc = { x: sgn, y: 0, z: 0 };
  const zc = { x: 0, y: -sgn * c, z: -s };
  const yc = { x: 0, y: sgn * s, z: -c };
  const proj = (p: { x: number; y: number; z: number }): Pt => {
    const d = { x: p.x - C.x, y: p.y - C.y, z: p.z - C.z };
    const X = xc.x * d.x + xc.y * d.y + xc.z * d.z;
    const Y = yc.x * d.x + yc.y * d.y + yc.z * d.z;
    const Z = zc.x * d.x + zc.y * d.y + zc.z * d.z;
    return { x: (f * X) / Z + w / 2, y: (f * Y) / Z + h / 2 };
  };
  const corners = WORLD_CORNERS.map((q) => proj({ x: q.x, y: q.y, z: 0 })) as Calibration["corners"];
  return { corners, stumpTop: proj({ x: 0, y: PITCH_LENGTH, z: STUMP_HEIGHT }), imageWidth: w, imageHeight: h };
}
export const _rad = rad;
