import type { ProjectState } from "../types";

const AUTOSAVE_KEY = "mini-daw:autosave:v1";

export interface AutosavePayload {
  savedAt: number;
  /** Project state without buffers (assets keep peak data only). */
  project: ProjectState;
}

/** Snapshot a project to JSON-safe form (Float32Array peaks as base64). */
function serializeProject(p: ProjectState): unknown {
  const assets: ProjectState["assets"] = {};
  for (const [id, a] of Object.entries(p.assets)) {
    assets[id] = {
      ...a,
      // Drop bulky peaks for autosave to keep localStorage usage small.
      peaks: new Float32Array(0),
    };
  }
  return { ...p, assets };
}

export function autosave(project: ProjectState) {
  try {
    const payload: AutosavePayload = {
      savedAt: Date.now(),
      project: serializeProject(project) as ProjectState,
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
  } catch {
    /* localStorage may be full or unavailable */
  }
}

export function loadAutosave(): AutosavePayload | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AutosavePayload;
    if (!parsed?.project) return null;
    // Re-hydrate peaks as empty Float32Arrays so the rest of the code
    // still treats `peaks` as a typed array.
    for (const a of Object.values(parsed.project.assets)) {
      a.peaks = new Float32Array(a.peaks ?? 0);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}
