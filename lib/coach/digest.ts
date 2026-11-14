import type { BallRecord, SessionSummary } from "@/lib/types";
import { batSeries, corr, sessionStats, timingByLength } from "@/lib/analytics/aggregate";

const r1 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

/** Compact, token-cheap description of one delivery for the live coach. */
export function ballDigest(b: BallRecord) {
  return {
    n: b.index, kph: r1(b.speedKph), length: b.length, line: b.line, shot: b.shot, timing: b.timing,
    outcome: { runs: b.outcome.runs, extra: b.outcome.extra, wicket: b.outcome.wicket, boundary: b.outcome.boundary },
    bowl: b.bowling && {
      overstepCm: r1(b.bowling.frontFootOverCreaseCm), elbowExtDeg: r1(b.bowling.elbowExtensionDeg), kneeDeg: r1(b.bowling.frontKneeBraceDeg),
      counterRotDeg: r1(b.bowling.counterRotationDeg), xFactorDeg: r1(b.bowling.hipShoulderSepDeg), releaseH: r1(b.bowling.releaseHeightM), disguise: b.bowling.disguiseScore,
    },
    bat: b.batting && {
      frontFootPct: r1(b.batting.frontFootPct), headDriftCm: r1(b.batting.headDriftCm), strideCm: r1(b.batting.strideCm),
      triggerMs: r1(b.batting.triggerMs), backliftDeg: r1(b.batting.backliftDeg), bottomHandPct: r1(b.batting.bottomHandPct),
    },
    flags: b.flags,
  };
}

/** Session-level digest for the post-session dossier. */
export function sessionDigest(s: SessionSummary) {
  const st = sessionStats(s.balls);
  const bs = batSeries(s.balls).filter((p) => p.swing);
  return {
    config: s.config, score: `${s.runs}/${s.wickets} (${s.legalBalls} legal balls)`, stats: st,
    timingByLength: timingByLength(s.balls).map((t) => ({ ...t, sweet: r1(t.sweet), early: r1(t.early), late: r1(t.late), edge: r1(t.edge), miss: r1(t.miss) })),
    correlations: {
      headDriftVsFrontFoot: r1(corr(bs.map((p) => p.headDrift), bs.map((p) => p.frontFoot))),
      strideVsWrist: r1(corr(bs.map((p) => p.stride), bs.map((p) => p.wrist))),
    },
    balls: s.balls.map(ballDigest),
  };
}
