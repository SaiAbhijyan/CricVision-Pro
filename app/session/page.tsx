"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import SimSession from "@/components/SimSession";
import LiveSession from "@/components/LiveSession";
import { DEFAULT_CONFIG } from "@/components/SetupPanel";
import type { SessionConfig } from "@/lib/types";

function Inner() {
  const mode = useSearchParams().get("mode") ?? "sim";
  const [cfg, setCfg] = useState<SessionConfig | null>(null);
  useEffect(() => { try { setCfg({ ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem("cvp-config") ?? "{}") }); } catch { setCfg(DEFAULT_CONFIG); } }, []);
  if (!cfg) return <p className="text-white/50">Loading…</p>;
  return mode === "live" ? <LiveSession cfg={cfg} /> : <SimSession cfg={cfg} />;
}
export default function Page() { return <Suspense fallback={null}><Inner /></Suspense>; }
