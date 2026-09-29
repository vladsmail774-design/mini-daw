export interface AudioTaskOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}
export function runAudioWorker<T>(operation: string, payload: Record<string, unknown>, opts: AudioTaskOptions = {}): Promise<T> {
  opts.signal?.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL("./processing.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { worker.terminate(); opts.signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    worker.onerror = event => { cleanup(); reject(new Error(event.message || "Audio worker failed")); };
    worker.onmessage = event => {
      const message = event.data;
      if (message.type === "progress") opts.onProgress?.(message.fraction);
      else if (message.type === "error") { cleanup(); reject(new Error(message.message)); }
      else { cleanup(); opts.onProgress?.(1); resolve(message.result as T); }
    };
    opts.signal?.addEventListener("abort", abort, { once: true });
    const channels = payload.channels as Float32Array[] | undefined;
    worker.postMessage({ operation, ...payload }, channels?.map(channel => channel.buffer as ArrayBuffer) ?? []);
  });
}
