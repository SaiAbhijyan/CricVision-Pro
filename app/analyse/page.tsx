"use client";
import { useEffect, useState } from "react";
import UploadSession from "@/components/UploadSession";
import { DEFAULT_CONFIG } from "@/components/SetupPanel";
import type { SessionConfig } from "@/lib/types";

export default function Page() {
  const [cfg, setCfg] = useState<SessionConfig | null>(null);
  useEffect(() => { try { setCfg({ ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem("cvp-config") ?? "{}") }); } catch { setCfg(DEFAULT_CONFIG); } }, []);
  return cfg ? <UploadSession cfg={cfg} /> : <p className="text-white/50">Loading…</p>;
}
