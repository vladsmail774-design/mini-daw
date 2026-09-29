/** Original encoded files live outside the document and Undo snapshots. */
const originals = new Map<string, Blob>();
export function registerMedia(id: string, blob: Blob) { originals.set(id, blob); }
export function getMedia(id: string) { return originals.get(id); }
export function unregisterMedia(id: string) { originals.delete(id); }
export function replaceMedia(media: Map<string, Blob>) {
  originals.clear();
  for (const [id, blob] of media) originals.set(id, blob);
}
