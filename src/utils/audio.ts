export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return 20 * Math.log10(Math.max(g, 1e-6));
}

export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(2).padStart(5, "0")}`;
}

/**
 * Вычисляет пики волны для визуализации
 * @param channelData - данные каналов аудио
 * @param peaksCount - количество пиков для вычисления
 * @returns массив нормализованных пиков (0-1)
 */
export function computeWaveformPeaks(channelData: Float32Array[], peaksCount: number): number[] {
  if (!channelData || channelData.length === 0) return [];
  
  const samples = channelData[0].length;
  const blockSize = Math.floor(samples / peaksCount);
  const peaks: number[] = [];
  
  for (let i = 0; i < peaksCount; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, samples);
    
    let max = 0;
    for (let j = start; j < end; j++) {
      // Микшируем все каналы
      let sample = 0;
      for (let ch = 0; ch < channelData.length; ch++) {
        sample += channelData[ch][j];
      }
      sample /= channelData.length;
      
      const abs = Math.abs(sample);
      if (abs > max) max = abs;
    }
    
    peaks.push(max);
  }
  
  return peaks;
}

/**
 * Асинхронное декодирование аудио с использованием Web Worker
 * @param arrayBuffer - буфер аудиофайла
 * @param id - уникальный идентификатор задачи
 * @returns промис с данными AudioBuffer
 */
export async function decodeAudioWithWorker(
  arrayBuffer: ArrayBuffer,
  id: string
): Promise<{
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  duration: number;
  channelData: Float32Array[];
}> {
  const { audioWorkerManager } = await import('../workers/audioWorkerManager');
  return audioWorkerManager.decodeAudio(id, arrayBuffer);
}

/**
 * Асинхронный анализ волны с использованием Web Worker
 * @param channelData - данные каналов аудио
 * @param peaksCount - количество пиков
 * @param id - уникальный идентификатор задачи
 * @returns промис с массивом пиков
 */
export async function analyzeWaveformWithWorker(
  channelData: Float32Array[],
  peaksCount: number,
  id: string
): Promise<number[]> {
  const { audioWorkerManager } = await import('../workers/audioWorkerManager');
  return audioWorkerManager.analyzeWaveform(id, channelData, peaksCount);
}
