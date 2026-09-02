import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { sampleTraffic } from './services/traffic';
import { pingHost, pingSweep, checkTcpPort } from './services/ping';
import { discoverArp } from './services/arp';
import { pollSnmp } from './services/snmp';
import { TerminalSession } from './services/terminal';

let mainWindow: BrowserWindow | undefined;
let terminal: TerminalSession | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#0c1322',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.argv.includes('--dev')) {
    void mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle('network:overview', () => sampleTraffic());
  ipcMain.handle('network:ping', (_event, host: string) => pingHost(host));
  ipcMain.handle('network:tcp', (_event, host: string, port: number) => checkTcpPort(host, port));
  ipcMain.handle('network:sweep', (_event, hosts: string[]) => pingSweep(hosts));
  ipcMain.handle('network:arp', () => discoverArp());
  ipcMain.handle('network:snmp', (_event, options) => pollSnmp(options));
  ipcMain.handle('terminal:connect', (event, config) => {
    terminal?.close();
    terminal = new TerminalSession();
    terminal.connect(
      config,
      (data) => event.sender.send('terminal:data', data),
      (message) => event.sender.send('terminal:data', `\r\n\x1b[31m${message ?? 'Disconnected'}\x1b[0m\r\n`),
    );
    return true;
  });
  ipcMain.on('terminal:write', (_event, data: string) => terminal?.write(data));
  ipcMain.on('terminal:close', () => {
    terminal?.close();
    terminal = undefined;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
