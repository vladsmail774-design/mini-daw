/**
 * Web Worker для декодирования аудиофайлов
 * Работает в отдельном потоке, не блокируя основной UI
 */

type DecodeMessage = {
  type: 'DECODE_AUDIO';
  id: string;
  arrayBuffer: ArrayBuffer;
};

type AnalyzeMessage = {
  type: 'ANALYZE_WAVEFORM';
  id: string;
  channelData: Float32Array[];
  peaksCount: number;
};

type Message = DecodeMessage | AnalyzeMessage;

self.onmessage = async (event: MessageEvent<Message>) => {
  const { type } = event.data;

  if (type === 'DECODE_AUDIO') {
    const { id, arrayBuffer } = event.data as DecodeMessage;
    
    try {
      const audioContext = new AudioContext({ sampleRate: 44100 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      
      // Сериализуем AudioBuffer для передачи обратно в главный поток
      const channelData: Float32Array[] = [];
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        channelData.push(audioBuffer.getChannelData(i));
      }
      
      self.postMessage({
        type: 'DECODE_SUCCESS',
        id,
        data: {
          sampleRate: audioBuffer.sampleRate,
          length: audioBuffer.length,
          numberOfChannels: audioBuffer.numberOfChannels,
          duration: audioBuffer.duration,
          channelData,
        },
      });
      
      audioContext.close();
    } catch (error) {
      self.postMessage({
        type: 'DECODE_ERROR',
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } else if (type === 'ANALYZE_WAVEFORM') {
    const { id, channelData, peaksCount } = event.data as AnalyzeMessage;
    
    try {
      // Объединяем все каналы в один микс для анализа
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
      
      self.postMessage({
        type: 'ANALYZE_SUCCESS',
        id,
        peaks,
      });
    } catch (error) {
      self.postMessage({
        type: 'ANALYZE_ERROR',
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
};

export {};
