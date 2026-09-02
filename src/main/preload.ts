import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  getOverview: () => ipcRenderer.invoke('network:overview'),
  ping: (host: string) => ipcRenderer.invoke('network:ping', host),
  tcpCheck: (host: string, port: number) => ipcRenderer.invoke('network:tcp', host, port),
  sweep: (hosts: string[]) => ipcRenderer.invoke('network:sweep', hosts),
  discoverArp: () => ipcRenderer.invoke('network:arp'),
  pollSnmp: (options: unknown) => ipcRenderer.invoke('network:snmp', options),
  terminalConnect: (config: unknown) => ipcRenderer.invoke('terminal:connect', config),
  terminalWrite: (data: string) => ipcRenderer.send('terminal:write', data),
  terminalClose: () => ipcRenderer.send('terminal:close'),
  onTerminalData: (callback: (data: string) => void) => {
    const listener = (_event: unknown, data: string) => callback(data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
});
