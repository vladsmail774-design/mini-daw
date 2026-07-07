/**
 * Generate a unique ID using crypto.randomUUID() when available.
 * Falls back to a timestamp-based approach for older browsers.
 */
export function uid(prefix = "id"): string {
  // Use crypto.randomUUID() in modern browsers - no collision risk even with HMR
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    const uuid = crypto.randomUUID();
    // Use first 8 chars of UUID for brevity
    return `${prefix}_${uuid.slice(0, 8)}`;
  }
  // Fallback for older environments
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
