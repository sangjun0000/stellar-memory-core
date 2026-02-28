export {};

declare global {
  interface Window {
    electronAPI?: {
      openPath: (filePath: string) => Promise<string>;
    };
  }
}
