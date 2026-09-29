import type { AudioAsset } from "../types";
import { uid } from "../utils/id";
import { getAudioEngine } from "./AudioEngine";
import { decodeAndAnalyze } from "./waveform";
import { registerMedia } from "../state/mediaRegistry";
import { getProjectEpoch } from "../state/session";

export type AudioImportProgress = {
  index: number;
  total: number;
  fileName: string;
  status: "decoding" | "done" | "failed";
  fraction?: number;
};

export type AudioImportFailure = {
  fileName: string;
  reason: string;
};

export async function importAudioFiles(
  files: FileList | File[],
  onProgress?: (progress: AudioImportProgress) => void,
  signal?: AbortSignal,
): Promise<{
  assets: AudioAsset[];
  failures: AudioImportFailure[];
}> {
  const audioFiles = Array.from(files);
  const epoch = getProjectEpoch();
  const engine = getAudioEngine();
  const assets: AudioAsset[] = [];
  const failures: AudioImportFailure[] = [];

  for (let fileIndex = 0; fileIndex < audioFiles.length; fileIndex++) {
    if (signal?.aborted || getProjectEpoch() !== epoch) break;
    const file = audioFiles[fileIndex];
    onProgress?.({
      index: fileIndex + 1,
      total: audioFiles.length,
      fileName: file.name,
      status: "decoding",
    });

    try {
      if (!isLikelyAudioFile(file)) throw new Error("Unsupported audio format");
      await engine.resume();
      const arrayBuffer = await file.arrayBuffer();
      const { buffer, peaks, peaksPerSecond } = await decodeAndAnalyze(engine.ctx, arrayBuffer, 200, { signal, onProgress: fraction => onProgress?.({ index: fileIndex + 1, total: audioFiles.length, fileName: file.name, status: "decoding", fraction }) });
      if (signal?.aborted || getProjectEpoch() !== epoch) break;
      const assetId = uid("asset");
      engine.registerBuffer(assetId, buffer);
      registerMedia(assetId, file);
      assets.push({
        id: assetId,
        name: file.name,
        durationSec: buffer.duration,
        sampleRate: buffer.sampleRate,
        numChannels: buffer.numberOfChannels,
        peaks,
        peaksPerSecond,
      });
      onProgress?.({
        index: fileIndex + 1,
        total: audioFiles.length,
        fileName: file.name,
        status: "done",
      });
    } catch (error) {
      if (signal?.aborted || getProjectEpoch() !== epoch) break;
      failures.push({
        fileName: file.name,
        reason: error instanceof Error ? error.message : "Unknown decode error",
      });
      onProgress?.({
        index: fileIndex + 1,
        total: audioFiles.length,
        fileName: file.name,
        status: "failed",
      });
    }
  }

  return { assets, failures };
}

export function isLikelyAudioFile(file: File) {
  return (
    file.type.startsWith("audio/") ||
    /\.(aac|aif|aiff|flac|m4a|mp3|ogg|opus|wav|webm)$/i.test(file.name)
  );
}
