import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import net from 'node:net';
import fs from 'node:fs';
import { SerialPort } from 'serialport';

export type TerminalProtocol = 'ssh' | 'telnet' | 'tcp' | 'serial';
export type TerminalForwardingConfig = { localPort?: number; remoteHost?: string; remotePort?: number };
export type TerminalLoggingConfig = { enabled?: boolean; path?: string };
export type SavedCredentialMetadata = { id?: string; label?: string; username?: string };
export interface TerminalConfig {
  protocol?: TerminalProtocol;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  category?: string;
  savedCredential?: SavedCredentialMetadata;
  scrollback?: number;
  logging?: TerminalLoggingConfig;
  forwarding?: TerminalForwardingConfig;
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
}

export class TerminalSession {
  private readonly client = new Client();
  private channel?: ClientChannel;
  private socket?: net.Socket;
  private serial?: SerialPort;

  connect(config: TerminalConfig, onData: (data: string) => void, onClose: (message?: string) => void): void {
    if (config.protocol === 'serial') {
      this.serial = new SerialPort({ path: config.host, baudRate: config.baudRate ?? config.port ?? 9600, dataBits: config.dataBits ?? 8, stopBits: config.stopBits ?? 1, parity: config.parity ?? 'none' });
      this.serial.on('data', (data: Buffer) => onData(data.toString()));
      this.serial.on('close', () => onClose('Serial connection closed'));
      this.serial.on('error', (error) => onClose(error.message));
      return;
    }
    if (config.protocol === 'telnet' || config.protocol === 'tcp') {
      this.socket = net.createConnection({ host: config.host, port: config.port ?? (config.protocol === 'telnet' ? 23 : 9000) });
      this.socket.on('data', (data) => onData(data.toString()));
      this.socket.on('close', () => onClose('Connection closed'));
      this.socket.on('error', (error) => onClose(error.message));
      return;
    }
    let privateKey = config.privateKey;
    if (!privateKey && config.privateKeyPath) {
      privateKey = fs.readFileSync(config.privateKeyPath, 'utf8');
    }
    if (privateKey) {
      privateKey = privateKey.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim() + '\n';
      if (!privateKey.includes('-----BEGIN ')) {
        throw new Error('SSH private key must be PEM or OpenSSH format');
      }
    }
    const connection: ConnectConfig = {
      host: config.host,
      port: config.port ?? 22,
      username: config.username,
      password: config.password,
      privateKey,
      passphrase: config.passphrase,
    };
    this.client.on('ready', () => {
      this.client.shell((error, stream) => {
        if (error) return onClose(error.message);
        this.channel = stream;
        stream.on('data', (data: Buffer) => onData(data.toString()));
        stream.on('close', () => onClose('Remote shell closed'));
      });
    });
    this.client.on('error', (error) => onClose(error.message));
    this.client.connect(connection);
  }

  write(data: string): void {
    if (this.socket) this.socket.write(data);
    else if (this.serial) this.serial.write(data);
    else this.channel?.write(data);
  }

  close(): void {
    this.socket?.destroy();
    if (this.serial?.isOpen) this.serial.close();
    this.channel?.close();
    this.client.end();
  }
}
