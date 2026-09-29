export {};
declare global {
  interface Window {
    miniDaw?: {
      openProject: () => Promise<{ name: string; bytes: ArrayBuffer } | null>;
      saveProject: (bytes: ArrayBuffer, suggestedName: string, saveAs: boolean) => Promise<{ name: string } | null>;
      resetProjectPath: () => Promise<void>;
    };
  }
  const __APP_VERSION__: string;
}
