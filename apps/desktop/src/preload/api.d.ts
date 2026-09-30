export {};

declare global {
  interface Window {
    /** Exposed by the preload script. Undefined when the renderer runs in a plain browser. */
    ff?: {
      platform: string;
      getConfig(): Promise<{ apiUrl: string; token: string }>;
      setConfig(c: { apiUrl: string; token: string }): Promise<{ apiUrl: string; token: string }>;
      openExternal(url: string): Promise<void>;
      notify(title: string, body: string): Promise<void>;
    };
  }
}
