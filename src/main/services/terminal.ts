import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import net from 'node:net';

export type TerminalProtocol = 'ssh' | 'telnet' | 'tcp';
export interface TerminalConfig {
  protocol?: TerminalProtocol;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export class TerminalSession {
  private readonly client = new Client();
  private channel?: ClientChannel;
  private socket?: net.Socket;

  connect(config: TerminalConfig, onData: (data: string) => void, onClose: (message?: string) => void): void {
    if (config.protocol === 'telnet' || config.protocol === 'tcp') {
      this.socket = net.createConnection({ host: config.host, port: config.port ?? (config.protocol === 'telnet' ? 23 : 9000) });
      this.socket.on('data', (data) => onData(data.toString()));
      this.socket.on('close', () => onClose('Connection closed'));
      this.socket.on('error', (error) => onClose(error.message));
      return;
    }
    const connection: ConnectConfig = {
      host: config.host,
      port: config.port ?? 22,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
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
    else this.channel?.write(data);
  }

  close(): void {
    this.socket?.destroy();
    this.channel?.close();
    this.client.end();
  }
}
