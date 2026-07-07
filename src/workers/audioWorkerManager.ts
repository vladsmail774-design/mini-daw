/**
 * Менеджер Web Worker для аудио операций
 * Управляет пулом воркеров и распределением задач
 */

type WorkerResponse = {
  type: 'DECODE_SUCCESS' | 'DECODE_ERROR' | 'ANALYZE_SUCCESS' | 'ANALYZE_ERROR';
  id: string;
  data?: {
    sampleRate: number;
    length: number;
    numberOfChannels: number;
    duration: number;
    channelData: Float32Array[];
  };
  peaks?: number[];
  error?: string;
};

type PendingTask = {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
};

class AudioWorkerManager {
  private worker: Worker | null = null;
  private pendingTasks: Map<string, PendingTask> = new Map();
  private initialized: boolean = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    this.worker = new Worker(new URL('./audioWorker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { type, id, data, peaks, error } = event.data;
      const task = this.pendingTasks.get(id);
      
      if (!task) {
        console.warn(`[AudioWorker] No pending task for id: ${id}`);
        return;
      }

      this.pendingTasks.delete(id);

      if (type === 'DECODE_SUCCESS') {
        task.resolve({ success: true, data });
      } else if (type === 'DECODE_ERROR') {
        task.reject(new Error(error || 'Decode failed'));
      } else if (type === 'ANALYZE_SUCCESS') {
        task.resolve({ success: true, peaks });
      } else if (type === 'ANALYZE_ERROR') {
        task.reject(new Error(error || 'Analyze failed'));
      }
    };

    this.worker.onerror = (error) => {
      console.error('[AudioWorker] Worker error:', error);
    };

    this.initialized = true;
  }

  async decodeAudio(id: string, arrayBuffer: ArrayBuffer): Promise<{
    sampleRate: number;
    length: number;
    numberOfChannels: number;
    duration: number;
    channelData: Float32Array[];
  }> {
    await this.init();

    return new Promise((resolve, reject) => {
      this.pendingTasks.set(id, { resolve, reject });
      
      this.worker!.postMessage({
        type: 'DECODE_AUDIO',
        id,
        arrayBuffer,
      }, [arrayBuffer]);
    });
  }

  async analyzeWaveform(
    id: string,
    channelData: Float32Array[],
    peaksCount: number
  ): Promise<number[]> {
    await this.init();

    return new Promise((resolve, reject) => {
      this.pendingTasks.set(id, { resolve, reject });
      
      // Передаем channelData как копию, т.к. Transferable не подходит для Float32Array из разных источников
      this.worker!.postMessage({
        type: 'ANALYZE_WAVEFORM',
        id,
        channelData,
        peaksCount,
      });
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      this.pendingTasks.clear();
    }
  }
}

// Singleton instance
export const audioWorkerManager = new AudioWorkerManager();
