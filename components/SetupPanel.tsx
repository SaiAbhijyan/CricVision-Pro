"use client";
import type { SessionConfig } from "@/lib/types";

export const DEFAULT_CONFIG: SessionConfig = {
  mode: "Full Match Duel (1v1)", handedness: "RHB", bowlerStyle: "Right Arm Pace", bowlerArm: "R", bowlingAngle: "Over the Wicket",
  boundaryRadius: 65, outfield: "Medium", surface: "Green/Seam", format: "Powerplay Chase",
  batterWaist: 1.0, batterShoulder: 1.45, batterHead: 1.75, audioOffsetMs: 0,
};

function Sel<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <label className="block"><span className="label">{label}</span>
      <select className="sel" value={value} onChange={(e) => onChange(e.target.value as T)}>{options.map((o) => <option key={o}>{o}</option>)}</select>
    </label>
  );
}

export default function SetupPanel({ cfg, onChange }: { cfg: SessionConfig; onChange: (c: SessionConfig) => void }) {
  const set = <K extends keyof SessionConfig>(k: K, v: SessionConfig[K]) => onChange({ ...cfg, [k]: v });
  const pace = cfg.bowlerStyle.includes("Pace");
  return (
    <div className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Sel label="Active mode" value={cfg.mode} options={["Batting Focus", "Bowling Focus", "Full Match Duel (1v1)"] as const} onChange={(v) => set("mode", v)} />
      <Sel label="Batter hand (mirrors analysis)" value={cfg.handedness} options={["RHB", "LHB"] as const} onChange={(v) => set("handedness", v)} />
      <Sel label="Bowler style" value={cfg.bowlerStyle} options={["Right Arm Pace", "Left Arm Pace", "Off-Spin", "Leg-Spin"] as const} onChange={(v) => onChange({ ...cfg, bowlerStyle: v, bowlerArm: v === "Left Arm Pace" ? "L" : v === "Right Arm Pace" ? "R" : cfg.bowlerArm })} />
      {!pace && <Sel label="Bowling arm" value={cfg.bowlerArm} options={["R", "L"] as const} onChange={(v) => set("bowlerArm", v)} />}
      <Sel label="Bowling angle" value={cfg.bowlingAngle} options={["Over the Wicket", "Round the Wicket"] as const} onChange={(v) => set("bowlingAngle", v)} />
      <Sel label="Pitch surface" value={cfg.surface} options={["Green/Seam", "Dry/Dusty", "Astro-Turf"] as const} onChange={(v) => set("surface", v)} />
      <Sel label="Outfield speed" value={cfg.outfield} options={["Slow", "Medium", "Lightning"] as const} onChange={(v) => set("outfield", v)} />
      <Sel label="Format" value={cfg.format} options={["Net Free-Hit", "Super Over", "Powerplay Chase"] as const} onChange={(v) => set("format", v)} />
      <label className="block"><span className="label">Boundary radius: {cfg.boundaryRadius} m</span>
        <input type="range" min={55} max={80} value={cfg.boundaryRadius} onChange={(e) => set("boundaryRadius", +e.target.value)} className="w-full accent-lime-400" />
      </label>
      <label className="block"><span className="label">Batter head height: {cfg.batterHead.toFixed(2)} m</span>
        <input type="range" min={1.4} max={2.0} step={0.01} value={cfg.batterHead} onChange={(e) => { const h = +e.target.value; onChange({ ...cfg, batterHead: h, batterShoulder: h * 0.83, batterWaist: h * 0.57 }); }} className="w-full accent-lime-400" />
      </label>
    </div>
  );
}
