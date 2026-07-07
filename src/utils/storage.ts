/**
 * Менеджер сохранения проектов
 * Сохраняет и загружает проекты в/из localStorage и IndexedDB
 */

const STORAGE_KEY = 'mini-daw-project';
const DB_NAME = 'MiniDAW';
const DB_VERSION = 1;
const ASSETS_STORE = 'assets';

// Тип для сериализованного проекта
export interface SerializedProject {
  version: string;
  savedAt: number;
  projectState: any;
  assetIds: string[];
}

// Инициализация IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
      }
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Сохранение проекта в localStorage
export async function saveProject(projectState: any): Promise<void> {
  try {
    const serialized: SerializedProject = {
      version: '1.0.0',
      savedAt: Date.now(),
      projectState,
      assetIds: Object.keys(projectState.assets || {}),
    };
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
    console.log('[Save] Project saved to localStorage');
  } catch (error) {
    console.error('[Save] Failed to save project:', error);
    throw error;
  }
}

// Загрузка проекта из localStorage
export async function loadProject(): Promise<SerializedProject | null> {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    
    const serialized = JSON.parse(data) as SerializedProject;
    console.log('[Load] Project loaded from localStorage');
    return serialized;
  } catch (error) {
    console.error('[Load] Failed to load project:', error);
    return null;
  }
}

// Сохранение аудио-ассета в IndexedDB
export async function saveAssetToIndexedDB(id: string, audioBuffer: AudioBuffer): Promise<void> {
  try {
    const db = await openDB();
    const transaction = db.transaction([ASSETS_STORE], 'readwrite');
    const store = transaction.objectStore(ASSETS_STORE);
    
    // Сериализуем AudioBuffer
    const channelData: Float32Array[] = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      channelData.push(audioBuffer.getChannelData(i));
    }
    
    const serialized = {
      id,
      sampleRate: audioBuffer.sampleRate,
      length: audioBuffer.length,
      numberOfChannels: audioBuffer.numberOfChannels,
      duration: audioBuffer.duration,
      channelData,
    };
    
    store.put(serialized);
    
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('[IndexedDB] Failed to save asset:', error);
    throw error;
  }
}

// Загрузка аудио-ассета из IndexedDB
export async function loadAssetFromIndexedDB(id: string, ctx: AudioContext): Promise<AudioBuffer | null> {
  try {
    const db = await openDB();
    const transaction = db.transaction([ASSETS_STORE], 'readonly');
    const store = transaction.objectStore(ASSETS_STORE);
    
    const request = store.get(id);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const data = request.result;
        if (!data) {
          resolve(null);
          return;
        }
        
        // Восстанавливаем AudioBuffer
        const buffer = ctx.createBuffer(
          data.numberOfChannels,
          data.length,
          data.sampleRate
        );
        
        for (let i = 0; i < data.numberOfChannels; i++) {
          buffer.getChannelData(i).set(data.channelData[i]);
        }
        
        resolve(buffer);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[IndexedDB] Failed to load asset:', error);
    return null;
  }
}

// Очистка всех данных
export async function clearAllData(): Promise<void> {
  try {
    localStorage.removeItem(STORAGE_KEY);
    
    const db = await openDB();
    const transaction = db.transaction([ASSETS_STORE], 'readwrite');
    const store = transaction.objectStore(ASSETS_STORE);
    store.clear();
    
    console.log('[Clear] All data cleared');
  } catch (error) {
    console.error('[Clear] Failed to clear data:', error);
    throw error;
  }
}

// Проверка наличия сохраненного проекта
export function hasSavedProject(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

// Получение метаинформации о сохраненном проекте
export function getProjectMeta(): { savedAt?: number; version?: string } | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    
    const serialized = JSON.parse(data) as SerializedProject;
    return {
      savedAt: serialized.savedAt,
      version: serialized.version,
    };
  } catch {
    return null;
  }
}
