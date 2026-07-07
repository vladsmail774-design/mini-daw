/**
 * Web Worker для тяжелых аудио-операций
 * Обрабатывает декодирование и анализ аудиофайлов в фоновом потоке
 */

type WorkerMessage = 
  | { type: 'DECODE_AUDIO'; payload: { fileData: ArrayBuffer; fileName: string } }
  | { type: 'ANALYZE_WAVEFORM'; payload: { audioData: Float32Array; samplesPerPoint: number } };

type WorkerResponse = 
  | { type: 'DECODE_SUCCESS'; payload: { fileName: string; audioBuffer: AudioBufferJSON; peaks: number[] } }
  | { type: 'DECODE_ERROR'; payload: { fileName: string; error: string } }
  | { type: 'WAVEFORM_READY'; payload: { peaks: number[] } };

// Сериализованная версия AudioBuffer для передачи между потоками
interface AudioBufferJSON {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  duration: number;
  channelData: Float32Array[];
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, payload } = e.data;

  try {
    if (type === 'DECODE_AUDIO') {
      const { fileData, fileName } = payload;
      
      // Создаем временный AudioContext внутри воркера
      const context = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 44100
      });

      const audioBuffer = await context.decodeAudioData(fileData.slice(0));
      
      // Извлекаем данные каналов
      const channelData: Float32Array[] = [];
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        channelData.push(audioBuffer.getChannelData(i));
      }

      // Вычисляем пики для визуализации (упрощенно: 1 точка на 1000 сэмплов)
      const samplesPerPoint = Math.max(1, Math.floor(audioBuffer.length / 2000));
      const peaks = computePeaks(channelData[0], samplesPerPoint);

      const serialized: AudioBufferJSON = {
        sampleRate: audioBuffer.sampleRate,
        length: audioBuffer.length,
        numberOfChannels: audioBuffer.numberOfChannels,
        duration: audioBuffer.duration,
        channelData
      };

      self.postMessage({
        type: 'DECODE_SUCCESS',
        payload: { fileName, audioBuffer: serialized, peaks }
      } as WorkerResponse);

      context.close();
    } 
    else if (type === 'ANALYZE_WAVEFORM') {
      const { audioData, samplesPerPoint } = payload;
      const peaks = computePeaks(audioData, samplesPerPoint);
      
      self.postMessage({
        type: 'WAVEFORM_READY',
        payload: { peaks }
      } as WorkerResponse);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (type === 'DECODE_AUDIO') {
      self.postMessage({
        type: 'DECODE_ERROR',
        payload: { 
          fileName: payload.fileName, 
          error: errorMessage 
        }
      } as WorkerResponse);
    }
  }
};

function computePeaks(data: Float32Array, samplesPerPoint: number): number[] {
  const peaks: number[] = [];
  const length = data.length;
  
  for (let i = 0; i < length; i += samplesPerPoint) {
    let min = 1.0;
    let max = -1.0;
    
    const end = Math.min(i + samplesPerPoint, length);
    for (let j = i; j < end; j++) {
      const value = data[j];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    
    peaks.push(Math.max(Math.abs(min), Math.abs(max)));
  }
  
  return peaks;
}

export {};
