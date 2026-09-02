/// <reference types="vite/client" />

interface DesktopApi {
  getOverview: () => Promise<{ adapters: Array<{ name: string; rxBytesPerSec: number; txBytesPerSec: number }>; activeAdapters: number; addresses: number; timestamp: string }>;
  ping: (host: string) => Promise<{ host: string; alive: boolean; time: number | null; output: string }>;
  tcpCheck: (host: string, port: number) => Promise<boolean>;
  sweep: (hosts: string[]) => Promise<Array<{ host: string; alive: boolean; time: number | null }>>;
  discoverArp: () => Promise<Array<{ ip: string; mac: string; type: string }>>;
  pollSnmp: (options: unknown) => Promise<Array<{ oid: string; value: string | number }>>;
  terminalConnect: (config: { protocol: 'ssh' | 'telnet' | 'tcp'; host: string; port?: number; username?: string; password?: string; privateKey?: string }) => Promise<boolean>;
  terminalWrite: (data: string) => void;
  terminalClose: () => void;
  onTerminalData: (callback: (data: string) => void) => () => void;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
