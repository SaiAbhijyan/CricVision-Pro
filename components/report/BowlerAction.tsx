"use client";
import type { BallRecord } from "@/lib/types";

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : "-");

/** Bowler's arm and action: ICC 15-degree elbow rule, arm slot, how fast the arm turns over, release point. */
export default function BowlerAction({ balls }: { balls: BallRecord[] }) {
  const b = balls.filter((x) => x.bowling).map((x) => ({ i: x.index, ...x.bowling! }));
  if (!b.length) return null;
  const worst = Math.max(...b.map((x) => x.elbowExtensionDeg));
  const over = b.filter((x) => x.elbowFlag).length;
  const pct = Math.min(100, (worst / 30) * 100);
  const tiles: [string, string, string][] = [
    ["Arm turnover", `${f(avg(b.map((x) => x.armRotationDegS)))} °/s`, "how fast the arm swings about the shoulder"],
    ["Arm slot", `${f(avg(b.map((x) => x.armSlotDeg)))}°`, "0 over the top, 90 round-arm"],
    ["Release height", `${f(avg(b.map((x) => x.releaseHeightM)), 2)} m`, `${f(avg(b.map((x) => x.releaseLateralCm)))} cm off the stump line`],
    ["Hip-shoulder split", `${f(avg(b.map((x) => x.hipShoulderSepDeg)))}°`, "power from the trunk"],
    ["Wrist snap", `${f(avg(b.map((x) => x.wristSnapDegS)))} °/s`, "at release"],
    ["Front knee", `${f(avg(b.map((x) => x.frontKneeBraceDeg)))}°`, "braced above 165°"],
  ];
  return (
    <section className="card space-y-3 break-inside-avoid">
      <div>
        <h3 className="text-lg font-bold">Bowler&apos;s action</h3>
        <p className="text-xs text-white/50">The ICC measures how much the elbow straightens between the upper arm being level and release. More than 15° is an illegal action. This is a screening estimate from video, not a lab test.</p>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-sm"><span>Elbow straightening (worst ball)</span><b className={worst > 15 ? "text-red-400" : "text-lime-glow"}>{f(worst, 1)}° {worst > 15 ? "over the 15° limit" : "inside the limit"}</b></div>
        <div className="relative h-3 rounded bg-white/10"><div className={`h-full rounded ${worst > 15 ? "bg-red-400" : "bg-lime-glow"}`} style={{ width: `${pct}%` }} /><div className="absolute top-[-3px] h-[18px] w-0.5 bg-white" style={{ left: "50%" }} /></div>
        <div className="mt-1 flex justify-between text-[11px] text-white/45"><span>0°</span><span>15° ICC limit</span><span>30°</span></div>
        <p className="mt-1 text-xs text-white/50">{over ? `${over} of ${b.length} deliveries were flagged.` : `No deliveries flagged out of ${b.length}.`}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">{tiles.map(([k, v, s]) => <div key={k} className="stat"><div className="label !mb-0">{k}</div><div className="text-xl font-bold">{v}</div><div className="text-[11px] text-white/45">{s}</div></div>)}</div>
    </section>
  );
}
