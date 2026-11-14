import type { BallOutcome, MatchFormat } from "@/lib/types";

export interface FormatRules {
  maxOvers: number; maxWickets: number; target: number | null;
  /** every delivery is a free hit (net practice): only run-outs would dismiss */
  allFreeHit: boolean; bouncersPerOver: number;
}

export const FORMAT_RULES: Record<MatchFormat, FormatRules> = {
  "Net Free-Hit": { maxOvers: 99, maxWickets: 99, target: null, allFreeHit: true, bouncersPerOver: 99 },
  "Super Over": { maxOvers: 1, maxWickets: 2, target: 13, allFreeHit: false, bouncersPerOver: 2 },
  "Powerplay Chase": { maxOvers: 6, maxWickets: 10, target: 55, allFreeHit: false, bouncersPerOver: 2 },
};

export interface WagonPoint { azimuthDeg: number; runs: number; boundary: 4 | 6 | null; distance: number }

export interface ScoreState {
  runs: number; wickets: number; legalBalls: number; extras: number;
  last: { label: string; runs: number; wicket: boolean; extra: string | null }[];
  freeHit: boolean; bouncersThisOver: number;
  wagon: WagonPoint[];
  rules: FormatRules;
  inningsOver: boolean;
}

export function newScore(format: MatchFormat): ScoreState {
  return { runs: 0, wickets: 0, legalBalls: 0, extras: 0, last: [], freeHit: FORMAT_RULES[format].allFreeHit, bouncersThisOver: 0, wagon: [], rules: FORMAT_RULES[format], inningsOver: false };
}

export const oversText = (legal: number) => `${Math.floor(legal / 6)}.${legal % 6}`;

export const crr = (s: ScoreState) => (s.legalBalls ? (s.runs * 6) / s.legalBalls : 0);
export function rrr(s: ScoreState): number | null {
  const t = s.rules.target;
  if (t === null) return null;
  const ballsLeft = s.rules.maxOvers * 6 - s.legalBalls;
  return ballsLeft > 0 ? (Math.max(0, t - s.runs) * 6) / ballsLeft : null;
}

export function ballLabel(o: BallOutcome): string {
  if (o.wicket) return "W";
  if (o.extra === "wide") return `${o.runs + o.extraRuns}wd`;
  if (o.extra === "noball") return `${o.runs + o.extraRuns}nb`;
  if (o.extra === "bye") return `${o.extraRuns}b`;
  if (o.extra === "legbye") return `${o.extraRuns}lb`;
  return o.runs === 0 ? "•" : String(o.runs);
}

export function applyOutcome(s: ScoreState, o: BallOutcome, wagon?: WagonPoint): ScoreState {
  const next: ScoreState = {
    ...s, last: [...s.last, { label: ballLabel(o), runs: o.runs + o.extraRuns, wicket: !!o.wicket, extra: o.extra }].slice(-6),
    wagon: wagon ? [...s.wagon, wagon] : s.wagon,
  };
  next.runs += o.runs + o.extraRuns;
  next.extras += o.extraRuns;
  if (o.wicket) next.wickets += 1;
  if (o.legal) {
    next.legalBalls += 1;
    if (next.legalBalls % 6 === 0) next.bouncersThisOver = 0;
  }
  next.freeHit = s.rules.allFreeHit || o.freeHitNext;
  if (next.wickets >= s.rules.maxWickets || next.legalBalls >= s.rules.maxOvers * 6) next.inningsOver = true;
  if (s.rules.target !== null && next.runs >= s.rules.target) next.inningsOver = true;
  return next;
}
