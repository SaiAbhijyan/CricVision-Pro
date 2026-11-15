import type { Calibration, ClipMeta, CoachReport, FieldPlayer, SessionSummary } from "@/lib/types";

export interface StoredSession extends SessionSummary {
  mode: "sim" | "live" | "upload";
  calibration: Calibration;
  field: FieldPlayer[];
  report?: CoachReport;
}

const DB = "cricvision-pro";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("clips")) db.createObjectStore("clips", { keyPath: "id" }).createIndex("sessionId", "sessionId");
      if (!db.objectStoreNames.contains("frames")) db.createObjectStore("frames");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((res, rej) => {
    const t = db.transaction(stores, mode);
    const rq = fn(t);
    t.oncomplete = () => { db.close(); res(rq ? (rq.result as T) : undefined); };
    t.onerror = () => { db.close(); rej(t.error); };
    t.onabort = () => { db.close(); rej(t.error); };
  }));
}

export const putSession = (s: StoredSession) => tx(["sessions"], "readwrite", (t) => t.objectStore("sessions").put(s)).then(() => undefined);
export const getSession = (id: string) => tx<StoredSession>(["sessions"], "readonly", (t) => t.objectStore("sessions").get(id) as IDBRequest<StoredSession>);
export const listSessions = async (): Promise<StoredSession[]> =>
  ((await tx<StoredSession[]>(["sessions"], "readonly", (t) => t.objectStore("sessions").getAll())) ?? []).sort((a, b) => b.startedAt - a.startedAt);
export const deleteSession = async (id: string) => {
  const clips = await getClips(id);
  await tx(["sessions", "clips", "frames"], "readwrite", (t) => {
    t.objectStore("sessions").delete(id);
    for (const c of clips) {
      t.objectStore("clips").delete(c.id);
      for (let i = 0; i < c.frameCount; i++) t.objectStore("frames").delete(`${c.id}:${i}`);
    }
  });
};

/** Persist a replay clip: overlay metadata + (optional) JPEG frames from the live circular buffer. */
export const putClip = (meta: ClipMeta, frames?: Blob[]) =>
  tx(["clips", "frames"], "readwrite", (t) => {
    t.objectStore("clips").put(meta);
    frames?.forEach((b, i) => t.objectStore("frames").put(b, `${meta.id}:${i}`));
  }).then(() => undefined);
export const getClips = async (sessionId: string): Promise<ClipMeta[]> =>
  ((await tx<ClipMeta[]>(["clips"], "readonly", (t) => t.objectStore("clips").index("sessionId").getAll(sessionId))) ?? []).sort((a, b) => a.ballIndex - b.ballIndex);
export const getFrame = (clipId: string, i: number) => tx<Blob>(["frames"], "readonly", (t) => t.objectStore("frames").get(`${clipId}:${i}`) as IDBRequest<Blob>);
export const hasFrames = async (clipId: string) => !!(await getFrame(clipId, 0));

export const exportSessionJson = async (id: string) => {
  const s = await getSession(id);
  const clips = await getClips(id);
  return JSON.stringify({ session: s, clips }, null, 2);
};
