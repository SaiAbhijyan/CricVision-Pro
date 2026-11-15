import type { Calibration, Pt } from "@/lib/types";

export type CameraEnd = "batter" | "bowler";

/**
 * The calibration overlay always lists the pitch corners in on-screen order (top-left, top-right, bottom-right,
 * bottom-left). For a camera behind the batter that matches the model's corner order; for a broadcast camera behind the
 * bowler's arm the world is rotated half a turn, so the corner that is on screen top-left is physically the one the
 * model calls "batter-right", and so on.
 */
export function orientCalibration(cal: Calibration, end: CameraEnd): Calibration {
  if (end === "batter") return cal;
  const c = cal.corners;
  return { ...cal, corners: [c[2], c[3], c[0], c[1]] as [Pt, Pt, Pt, Pt] };
}
