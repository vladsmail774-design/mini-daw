import type { AudioAsset, ProjectState } from "../types";
import { getMedia } from "./mediaRegistry";
import { initialAudioSettings } from "./model";

export const SCHEMA_VERSION = 2;
const MAGIC = "MDAWPK02";
const DB_NAME = "mini-daw-projects-v2";
type StoredProject = Omit<ProjectState, "assets"> & { assets: Record<string, Omit<AudioAsset, "peaks">> };
export interface ProjectDocument {
  schemaVersion: number; savedAt: number; project: StoredProject;
  /** Recovery-only immutable blob keys. Absent in legacy recovery and portable files. */
  mediaRefs?: Record<string, string>;
}
export interface ProjectBundle { document: ProjectDocument; media: Map<string, Blob> }

export function documentFor(project: ProjectState): ProjectDocument {
  const assets = Object.fromEntries(Object.entries(project.assets).map(([id, asset]) => {
    const { peaks: _peaks, ...metadata } = asset;
    void _peaks;
    return [id, metadata];
  }));
  return { schemaVersion: SCHEMA_VERSION, savedAt: Date.now(), project: { ...project, assets } };
}
export function projectFingerprint(project: ProjectState): string {
  const { pxPerSec: _zoom, ...doc } = documentFor(project).project;
  void _zoom;
  return JSON.stringify(doc);
}
export function migrateDocument(value: unknown): ProjectDocument {
  if (!value || typeof value !== "object") throw new Error("Invalid project document");
  const raw = value as Record<string, unknown>;
  const version = raw.schemaVersion ?? 1;
  if (version !== 1 && version !== SCHEMA_VERSION) throw new Error(`Unsupported project schema: ${String(version)}`);
  const project = raw.project as StoredProject;
  if (!project || !Array.isArray(project.tracks) || !Array.isArray(project.clips) || !project.assets || typeof project.assets !== "object" || Array.isArray(project.assets)) throw new Error("Invalid project: tracks, clips or media metadata are missing");
  const migrated = version === 1 ? { ...project, name: project.name ?? "Recovered project", masterEffects: project.masterEffects ?? [], audioSettings: { ...initialAudioSettings, ...project.audioSettings } } : project;
  let mediaRefs: Record<string, string> | undefined;
  if (raw.mediaRefs !== undefined) {
    if (!raw.mediaRefs || typeof raw.mediaRefs !== "object" || Array.isArray(raw.mediaRefs)) throw new Error("Invalid recovery media references");
    mediaRefs = {};
    for (const [id, key] of Object.entries(raw.mediaRefs)) {
      if (!Object.hasOwn(project.assets, id) || typeof key !== "string" || !key) throw new Error("Invalid recovery media reference");
      Object.defineProperty(mediaRefs, id, { value: key, enumerable: true, configurable: true, writable: true });
    }
  }
  return { schemaVersion: SCHEMA_VERSION, savedAt: typeof raw.savedAt === "number" ? raw.savedAt : Date.now(), project: migrated, ...(mediaRefs ? { mediaRefs } : {}) };
}
export function hydrateDocument(document: ProjectDocument): ProjectState {
  return { ...document.project, assets: Object.fromEntries(Object.entries(document.project.assets).map(([id, asset]) => [id, { ...asset, peaks: new Float32Array(0) }])) };
}

/** Single portable file: length-prefixed UTF-8 manifest, then untouched source bytes. */
export function snapshotMedia(project: ProjectState): Map<string, Blob> {
  return new Map(Object.keys(project.assets).map(id => {
    const blob = getMedia(id);
    if (!blob) throw new Error(`Missing media: ${project.assets[id].name}. Relink it before saving.`);
    return [id, blob] as const;
  }));
}
export function matchesMediaSnapshot(project: ProjectState, media: Map<string, Blob>): boolean {
  return Object.keys(project.assets).length === media.size && Object.keys(project.assets).every(id => media.get(id) === getMedia(id));
}

export async function packProject(project: ProjectState, sourceMedia = snapshotMedia(project)): Promise<Blob> {
  const media: { id: string; size: number; type: string }[] = [];
  const parts: BlobPart[] = [];
  for (const id of Object.keys(project.assets)) {
    const blob = sourceMedia.get(id);
    if (!blob) throw new Error(`Missing media: ${project.assets[id].name}. Relink it before saving.`);
    media.push({ id, size: blob.size, type: blob.type });
    parts.push(blob);
  }
  const header = new TextEncoder().encode(JSON.stringify({ ...documentFor(project), media }));
  const prefix = new Uint8Array(12);
  prefix.set(new TextEncoder().encode(MAGIC));
  new DataView(prefix.buffer).setUint32(8, header.byteLength, true);
  return new Blob([prefix, header, ...parts], { type: "application/x-mini-daw" });
}
export async function unpackProject(blob: Blob): Promise<ProjectBundle> {
  const prefix = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (prefix.length < 12 || new TextDecoder().decode(prefix.slice(0, 8)) !== MAGIC) {
    if (blob.size > 20_000_000) throw new Error("Unrecognized project format");
    return { document: migrateDocument(JSON.parse(await blob.text())), media: new Map() };
  }
  const headerSize = new DataView(prefix.buffer).getUint32(8, true);
  if (headerSize > 20_000_000 || headerSize > blob.size - 12) throw new Error("Damaged project header");
  const header = JSON.parse(await blob.slice(12, 12 + headerSize).text());
  const document = migrateDocument(header);
  if (!Array.isArray(header.media)) throw new Error("Missing media manifest");
  const media = new Map<string, Blob>();
  let offset = 12 + headerSize;
  for (const item of header.media) {
    if (typeof item.id !== "string" || !Object.hasOwn(document.project.assets, item.id) || media.has(item.id) || !Number.isSafeInteger(item.size) || item.size < 1 || offset + item.size > blob.size) throw new Error("Damaged media manifest");
    media.set(item.id, blob.slice(offset, offset + item.size, typeof item.type === "string" ? item.type : ""));
    offset += item.size;
  }
  if (offset !== blob.size) throw new Error("Unexpected trailing project data");
  return { document, media };
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("snapshots"); request.result.createObjectStore("media"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Recovery storage unavailable"));
    request.onblocked = () => reject(new Error("Close other Mini DAW windows to open recovery storage"));
  });
}
function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function completed(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("Recovery write aborted")); tx.onerror = () => reject(tx.error); });
}
const persistedMedia = new Map<string, { blob: Blob; key: string }>();
function mediaKey(document: ProjectDocument, id: string): string { return document.mediaRefs?.[id] ?? id; }
/** Metadata and encoded media commit atomically; failed writes preserve the old head. */
export async function autosave(project: ProjectState, blobs = snapshotMedia(project)): Promise<void> {
  const document = documentFor(project);
  for (const id of Object.keys(project.assets)) if (!blobs.has(id)) throw new Error(`Missing media: ${project.assets[id].name}`);
  const db = await database();
  try {
    const tx = db.transaction(["snapshots", "media"], "readwrite");
    const done = completed(tx);
    const snapshots = tx.objectStore("snapshots");
    const media = tx.objectStore("media");
    let writeError: unknown;
    const committedMedia = new Map<string, { blob: Blob; key: string }>();
    const headRequest = snapshots.get("current");
    headRequest.onsuccess = () => {
      try {
      const previous = headRequest.result as ProjectDocument | undefined;
      // Repeated blur/debounce saves of the same revision must not rotate away
      // the last useful recovery copy. Loaded blobs seed this identity cache.
      if (previous && projectFingerprint(hydrateDocument(previous)) === projectFingerprint(project)
        && [...blobs].every(([id, blob]) => persistedMedia.get(id)?.blob === blob && persistedMedia.get(id)?.key === mediaKey(previous, id))) return;
      // A relink keeps the logical asset ID but must not replace the bytes that
      // the previous recovery document references. Each revision gets a new key.
      const refs: [string, string][] = [];
      for (const [id, blob] of blobs) {
        const cached = persistedMedia.get(id);
        const reuse = cached?.blob === blob && previous && mediaKey(previous, id) === cached.key;
        const key = reuse ? cached.key : `media:${crypto.randomUUID()}`;
        if (!reuse) media.put(blob, key);
        refs.push([id, key]);
        committedMedia.set(id, { blob, key });
      }
      document.mediaRefs = Object.fromEntries(refs);
      if (previous) snapshots.put(previous, "previous");
      snapshots.put(document, "current");
      const retained = new Set([...refs.map(([, key]) => key), ...Object.keys(previous?.project.assets ?? {}).map(id => mediaKey(previous!, id))]);
      const cursor = media.openKeyCursor();
      cursor.onsuccess = () => { const item = cursor.result; if (item) { if (!retained.has(String(item.key))) media.delete(item.key); item.continue(); } };
      } catch (error) { writeError = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw writeError ?? error; }
    for (const [id, entry] of committedMedia) persistedMedia.set(id, entry);
    for (const id of persistedMedia.keys()) if (!blobs.has(id)) persistedMedia.delete(id);
  } finally { db.close(); }
}
export async function loadAutosave(previous = false): Promise<ProjectBundle | null> {
  const db = await database();
  try {
    const tx = db.transaction(["snapshots", "media"], "readonly");
    const done = completed(tx);
    const documentRequest = tx.objectStore("snapshots").get(previous ? "previous" : "current");
    const mediaRequest = tx.objectStore("media").getAll();
    const keysRequest = tx.objectStore("media").getAllKeys();
    const [raw, blobs, keys] = await Promise.all([result(documentRequest), result(mediaRequest), result(keysRequest)]);
    await done;
    if (!raw) {
      if (previous) return null;
      const legacy = localStorage.getItem("mini-daw:autosave:v1");
      return legacy ? { document: migrateDocument(JSON.parse(legacy)), media: new Map() } : null;
    }
    const document = migrateDocument(raw);
    const stored = new Map(keys.map((key, i) => [String(key), blobs[i] as Blob]));
    const media = new Map<string, Blob>();
    for (const id of Object.keys(document.project.assets)) {
      const blob = stored.get(mediaKey(document, id));
      if (blob) { media.set(id, blob); persistedMedia.set(id, { blob, key: mediaKey(document, id) }); }
    }
    return { document, media };
  } finally { db.close(); }
}
