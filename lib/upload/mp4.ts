/**
 * Exact frame rate of an MP4/MOV file from its sample table. A browser cannot be asked for this: requestVideoFrameCallback reports
 * frames as they are painted, so a 120 or 240 fps file on a 60 Hz screen looks like 60 fps. The container knows the truth.
 */
export type ReadAt = (start: number, end: number) => Promise<Uint8Array>;

interface Box { type: string; start: number; end: number; body: number }

async function boxes(read: ReadAt, from: number, to: number, limit = 4096): Promise<Box[]> {
  const out: Box[] = []; let p = from;
  while (p + 8 <= to && out.length < limit) {
    const h = await read(p, Math.min(p + 16, to)); if (h.length < 8) break;
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let size = dv.getUint32(0), hdr = 8;
    const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
    if (size === 1) { if (h.length < 16) break; size = dv.getUint32(8) * 4294967296 + dv.getUint32(12); hdr = 16; }
    else if (size === 0) size = to - p;
    if (size < hdr || p + size > to) { if (p + size > to && size >= hdr) size = to - p; else break; }
    out.push({ type, start: p, end: p + size, body: p + hdr }); p += size;
  }
  return out;
}

const find = (bs: Box[], t: string) => bs.find((b) => b.type === t);

/** Returns the average frame rate of the first video track, or null if the file is not an MP4/MOV with a readable sample table. */
export async function mp4Fps(size: number, read: ReadAt): Promise<number | null> {
  try {
    const top = await boxes(read, 0, size);
    const moov = find(top, "moov"); if (!moov) return null;
    for (const trak of (await boxes(read, moov.body, moov.end)).filter((b) => b.type === "trak")) {
      const mdia = find(await boxes(read, trak.body, trak.end), "mdia"); if (!mdia) continue;
      const m = await boxes(read, mdia.body, mdia.end);
      const hdlr = find(m, "hdlr"), mdhd = find(m, "mdhd"), minf = find(m, "minf"); if (!hdlr || !mdhd || !minf) continue;
      const h = await read(hdlr.body + 8, hdlr.body + 12); if (String.fromCharCode(...h) !== "vide") continue;
      const md = await read(mdhd.body, Math.min(mdhd.end, mdhd.body + 32)), mv = new DataView(md.buffer, md.byteOffset, md.byteLength);
      const timescale = md[0] === 1 ? mv.getUint32(20) : mv.getUint32(12); if (!timescale) continue;
      const stbl = find(await boxes(read, minf.body, minf.end), "stbl"); if (!stbl) continue;
      const stts = find(await boxes(read, stbl.body, stbl.end), "stts"); if (!stts) continue;
      const head = await read(stts.body + 4, stts.body + 8), n = new DataView(head.buffer, head.byteOffset, 4).getUint32(0);
      if (n === 0 || n > 200000) continue;
      const tb = await read(stts.body + 8, stts.body + 8 + n * 8), tv = new DataView(tb.buffer, tb.byteOffset, tb.byteLength);
      let frames = 0, ticks = 0;
      for (let i = 0; i < n && (i + 1) * 8 <= tb.length; i++) { const c = tv.getUint32(i * 8), d = tv.getUint32(i * 8 + 4); frames += c; ticks += c * d; }
      if (!frames || !ticks) continue;
      const fps = (frames * timescale) / ticks;
      return fps >= 1 && fps <= 1000 ? fps : null;
    }
    return null;
  } catch { return null; }
}

export const fileReader = (f: Blob): ReadAt => async (a, b) => new Uint8Array(await f.slice(a, b).arrayBuffer());
