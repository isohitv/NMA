import mongoose, { Schema } from 'mongoose';

export interface WatchTarget {
  value: string;
  label?: string;
  port?: number;
  latencyThreshold?: number;
  enabled?: boolean;
}

const watchTargetSchema = new Schema<WatchTarget>({
  value: { type: String, required: true },
  label: String,
  port: Number,
  latencyThreshold: { type: Number, default: 250 },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

export const WatchTargetModel = mongoose.model('WatchTarget', watchTargetSchema);

export interface PersistedTerminalSession {
  id: string;
  name: string;
  protocol: 'ssh' | 'telnet' | 'tcp' | 'serial';
  host: string;
  port: number;
  username?: string;
  category?: string;
  savedCredential?: { id?: string; label?: string; username?: string };
  scrollback: number;
  logging: { enabled: boolean; path?: string };
  forwarding?: { localPort?: number; remoteHost?: string; remotePort?: number };
  status: string;
  createdAt: string;
  lastActivity: string;
  history: Array<{ direction: string; data: string; timestamp: string }>;
}

const terminalSessionSchema = new Schema<PersistedTerminalSession>({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true }, protocol: { type: String, required: true },
  host: { type: String, required: true }, port: { type: Number, required: true },
  username: String, category: String, savedCredential: { id: String, label: String, username: String },
  scrollback: { type: Number, default: 200 }, logging: { enabled: Boolean, path: String },
  forwarding: { localPort: Number, remoteHost: String, remotePort: Number },
  status: String, createdAt: String, lastActivity: String, history: [{ direction: String, data: String, timestamp: String }],
}, { timestamps: false });

export const TerminalSessionModel = mongoose.model('TerminalSession', terminalSessionSchema);
