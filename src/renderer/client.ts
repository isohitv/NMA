type Json = Record<string, unknown>;
export type WatchTarget = { _id: string; value: string; label?: string; port?: number; latencyThreshold: number; enabled: boolean; status?: string; latency?: number | null; checkedAt?: string; createdAt: string };
export type TargetPoint = { timestamp: string; latency: number | null; status: string };
export type TerminalSession = { id: string; name: string; protocol: 'ssh' | 'telnet' | 'tcp' | 'serial'; host: string; port: number; username?: string; category?: string; savedCredential?: { id?: string; label?: string; username?: string }; scrollback?: number; logging?: { enabled: boolean; path?: string }; forwarding?: { localPort?: number; remoteHost?: string; remotePort?: number }; status: string; createdAt: string; lastActivity: string; history?: Array<{ direction: string; data: string; timestamp: string }> };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Json;
    throw new Error(String(body.error || `Request failed (${response.status})`));
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

const desktop = (window as Window & { desktop?: Record<string, (...args: any[]) => any> }).desktop;
export const api = {
  getOverview: () => desktop ? desktop.getOverview() : request<any>('/api/network/overview'),
  ping: (host: string) => desktop ? desktop.ping(host) : request('/api/network/ping', { method: 'POST', body: JSON.stringify({ host }) }),
  sweep: (hosts: string[]) => desktop ? desktop.sweep(hosts) : request<any[]>('/api/network/sweep', { method: 'POST', body: JSON.stringify({ hosts }) }),
  discoverArp: () => desktop ? desktop.discoverArp() : request<any[]>('/api/network/arp'),
  pollSnmp: (options: unknown) => desktop ? desktop.pollSnmp(options) : request<any[]>('/api/network/snmp', { method: 'POST', body: JSON.stringify(options) }),
  checkPorts: (host: string, ports: number[]) => request<any>('/api/network/ports', { method: 'POST', body: JSON.stringify({ host, ports }) }),
  getWatchlist: () => request<WatchTarget[]>('/api/watchlist'),
  addWatch: (target: Partial<WatchTarget>) => request<WatchTarget>('/api/watchlist', { method: 'POST', body: JSON.stringify(target) }),
  updateWatch: (id: string, target: Partial<WatchTarget>) => request<WatchTarget>(`/api/watchlist/${id}`, { method: 'PATCH', body: JSON.stringify(target) }),
  deleteWatch: (id: string) => request<void>(`/api/watchlist/${id}`, { method: 'DELETE' }),
  checkWatchlist: () => request<WatchTarget[]>('/api/watchlist/check', { method: 'POST' }),
  getWatchHistory: (id: string) => request<TargetPoint[]>(`/api/watchlist/${id}/history`),
  getSessions: () => desktop ? Promise.resolve([] as TerminalSession[]) : request<TerminalSession[]>('/api/terminal/sessions'),
  createSession: (config: any) => desktop ? Promise.resolve(desktop.terminalConnect(config)).then(() => ({ id: 'desktop', name: `${String(config.protocol || 'ssh').toUpperCase()} ${config.host}`, protocol: config.protocol || 'ssh', host: config.host, port: config.port || 22, status: 'connected', createdAt: new Date().toISOString(), lastActivity: new Date().toISOString() })) : request<TerminalSession>('/api/terminal/sessions', { method: 'POST', body: JSON.stringify(config) }),
  getSessionHistory: (id: string) => desktop ? Promise.resolve([]) : request<TerminalSession['history']>(`/api/terminal/sessions/${id}/history`),
  terminalWrite: (id: string, data: string) => desktop ? Promise.resolve(desktop.terminalWrite(data)) : request(`/api/terminal/sessions/${id}/write`, { method: 'POST', body: JSON.stringify({ data }) }),
  terminalClose: (id: string) => desktop ? Promise.resolve(desktop.terminalClose()) : request<void>(`/api/terminal/sessions/${id}`, { method: 'DELETE' }),
  exportTranscriptUrl: (id: string, format: 'json' | 'csv' | 'text' = 'text') => `/api/terminal/sessions/${encodeURIComponent(id)}/export?format=${format}`,
  search: (query: string) => request<any[]>(`/api/search?q=${encodeURIComponent(query)}`),
  exportUrl: (type: string, format: 'json' | 'csv') => `/api/export?type=${encodeURIComponent(type)}&format=${format}`,
  // Electron IPC remains available for the desktop build; browser terminals use REST/WebSocket-ready APIs.
  terminalConnect: async (config: any) => desktop ? desktop.terminalConnect(config) : api.createSession(config),
  onTerminalData: (_callback: (data: string) => void) => desktop?.onTerminalData ? desktop.onTerminalData(_callback) : () => undefined,
};
