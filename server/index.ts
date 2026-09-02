import cors from 'cors';
import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { sampleTraffic, TrafficSample } from '../src/main/services/traffic';
import { pingHost, pingSweep, checkTcpPort, PingResult } from '../src/main/services/ping';
import { discoverArp, ArpDevice } from '../src/main/services/arp';
import { pollSnmp } from '../src/main/services/snmp';
import { TerminalConfig, TerminalProtocol, TerminalSession } from '../src/main/services/terminal';
import { TerminalSessionModel, WatchTargetModel } from './models';

type WatchTarget = {
  _id: string;
  value: string;
  label?: string;
  port?: number;
  latencyThreshold: number;
  enabled: boolean;
  status?: 'online' | 'offline' | 'degraded' | 'unknown';
  latency?: number | null;
  checkedAt?: string;
  createdAt: string;
};
type TargetPoint = { timestamp: string; latency: number | null; status: string };
type SessionRecord = {
  id: string;
  name: string;
  protocol: TerminalProtocol;
  host: string;
  port: number;
  username?: string;
  category?: string;
  savedCredential?: { id?: string; label?: string; username?: string };
  scrollback: number;
  logging: { enabled: boolean; path?: string };
  forwarding?: { localPort?: number; remoteHost?: string; remotePort?: number };
  status: 'connecting' | 'connected' | 'closed' | 'error';
  createdAt: string;
  lastActivity: string;
  history: Array<{ direction: 'in' | 'out' | 'system'; data: string; timestamp: string }>;
  transport: TerminalSession;
};

const app = express();
const port = Number(process.env.PORT ?? 3001);
let databaseReady = false;
const memoryWatchlist: WatchTarget[] = [];
const targetHistory = new Map<string, TargetPoint[]>();
const sessions = new Map<string, SessionRecord>();
const networkLogs: Array<Record<string, unknown>> = [];
let deviceCache: ArpDevice[] = [];

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function addNetworkLog(event: Record<string, unknown>): void {
  networkLogs.unshift({ timestamp: new Date().toISOString(), ...event });
  if (networkLogs.length > 500) networkLogs.length = 500;
}

function publicSession(session: SessionRecord): Omit<SessionRecord, 'transport'> {
  const { transport: _transport, ...result } = session;
  return result;
}

async function persistSession(session: SessionRecord): Promise<void> {
  if (!databaseReady) return;
  const { transport: _transport, ...document } = session;
  await TerminalSessionModel.findOneAndUpdate({ id: session.id }, document, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function loadPersistedSessions(): Promise<void> {
  if (!databaseReady) return;
  const stored = await TerminalSessionModel.find().sort({ lastActivity: -1 }).lean();
  stored.forEach((item) => {
    sessions.set(item.id, {
      ...item,
      status: 'closed',
      history: item.history ?? [],
      logging: item.logging ?? { enabled: false },
      scrollback: item.scrollback || 200,
      transport: new TerminalSession(),
    } as SessionRecord);
  });
}

async function getWatchlist(): Promise<WatchTarget[]> {
  if (!databaseReady) return memoryWatchlist;
  return (await WatchTargetModel.find().sort({ createdAt: -1 }).lean()) as unknown as WatchTarget[];
}

async function checkTarget(target: WatchTarget): Promise<WatchTarget> {
  if (!target.enabled) return target;
  try {
    const [result, tcpReachable] = await Promise.all([
      pingHost(target.value),
      target.port ? checkTcpPort(target.value, target.port) : Promise.resolve(true),
    ]);
    const threshold = target.latencyThreshold || 250;
    const status = !result.alive || !tcpReachable ? 'offline' : (result.time !== null && result.time > threshold ? 'degraded' : 'online');
    const checkedAt = new Date().toISOString();
    const latency = result.time;
    const update: Pick<WatchTarget, 'status' | 'latency' | 'checkedAt'> = { status, latency, checkedAt };
    const points = targetHistory.get(target._id) ?? [];
    points.push({ timestamp: checkedAt, latency, status });
    targetHistory.set(target._id, points.slice(-60));
    if (!databaseReady) Object.assign(target, update);
    else await WatchTargetModel.findByIdAndUpdate(target._id, update);
    addNetworkLog({ type: 'watchlist-check', target: target.value, port: target.port, status, latency: result.time });
    return { ...target, ...update };
  } catch {
    const checkedAt = new Date().toISOString();
    const points = targetHistory.get(target._id) ?? [];
    points.push({ timestamp: checkedAt, latency: null, status: 'offline' });
    targetHistory.set(target._id, points.slice(-60));
    return { ...target, status: 'offline', latency: null, checkedAt };
  }
}

async function checkAllTargets(): Promise<void> {
  const targets = await getWatchlist();
  await Promise.all(targets.map((target) => checkTarget(target)));
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'sentinel-api', database: databaseReady ? 'mongo' : 'memory' }));

app.get('/api/network/overview', async (_req, res, next) => {
  try {
    const sample = await sampleTraffic();
    addNetworkLog({ type: 'traffic', adapters: sample.adapters, protocolBreakdown: sample.protocolBreakdown });
    res.json(sample);
  } catch (error) { next(error); }
});
app.get('/api/network/traffic', async (_req, res, next) => {
  try { res.json(await sampleTraffic()); } catch (error) { next(error); }
});
app.get('/api/network/logs', (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  res.json(networkLogs.slice(0, limit));
});
app.post('/api/network/ping', async (req, res, next) => {
  try { res.json(await pingHost(String(req.body.host))); } catch (error) { next(error); }
});
app.post('/api/network/sweep', async (req, res, next) => {
  try {
    const result = await pingSweep(Array.isArray(req.body.hosts) ? req.body.hosts.map(String) : []);
    result.forEach((item) => addNetworkLog({ type: 'ping', ...item }));
    res.json(result);
  } catch (error) { next(error); }
});
app.post('/api/network/tcp', async (req, res, next) => {
  try {
    const host = String(req.body.host);
    const tcpPort = Number(req.body.port);
    const reachable = await checkTcpPort(host, tcpPort);
    addNetworkLog({ type: 'tcp', host, port: tcpPort, reachable });
    res.json({ host, port: tcpPort, reachable, status: reachable ? 'open' : 'closed' });
  } catch (error) { next(error); }
});
app.get('/api/network/arp', async (_req, res, next) => {
  try { deviceCache = await discoverArp(); addNetworkLog({ type: 'arp-discovery', count: deviceCache.length }); res.json(deviceCache); } catch (error) { next(error); }
});
app.post('/api/network/snmp', async (req, res, next) => {
  try { res.json(await pollSnmp(req.body)); } catch (error) { next(error); }
});
app.post('/api/network/ports', async (req, res, next) => {
  try {
    const host = String(req.body.host);
    const ports = Array.isArray(req.body.ports) ? req.body.ports.map(Number).filter((item: number) => item > 0 && item < 65536) : [];
    const statuses = await Promise.all(ports.map(async (item: number) => ({ port: item, reachable: await checkTcpPort(host, item) })));
    res.json({ host, ports: statuses });
  } catch (error) { next(error); }
});

app.get('/api/watchlist', async (_req, res, next) => { try { res.json(await getWatchlist()); } catch (error) { next(error); } });
app.post('/api/watchlist', async (req, res, next) => {
  try {
    const value = String(req.body.value ?? '').trim();
    if (!value) return res.status(400).json({ error: 'A host or IP address is required' });
    const target = { value, label: req.body.label ? String(req.body.label) : undefined, port: req.body.port ? Number(req.body.port) : undefined, latencyThreshold: Number(req.body.latencyThreshold) || 250, enabled: req.body.enabled !== false };
    if (!databaseReady) {
      const item: WatchTarget = { _id: crypto.randomUUID(), ...target, status: 'unknown', latency: null, createdAt: new Date().toISOString() };
      memoryWatchlist.unshift(item);
      targetHistory.set(item._id, []);
      return res.status(201).json(await checkTarget(item));
    }
    const item = await WatchTargetModel.create(target);
    res.status(201).json(await checkTarget(item.toObject() as unknown as WatchTarget));
  } catch (error) { next(error); }
});
app.patch('/api/watchlist/:id', async (req, res, next) => {
  try {
    const changes: Partial<WatchTarget> = {};
    if (req.body.value !== undefined) changes.value = String(req.body.value).trim();
    if (req.body.label !== undefined) changes.label = String(req.body.label);
    if (req.body.port !== undefined) changes.port = Number(req.body.port) || undefined;
    if (req.body.latencyThreshold !== undefined) changes.latencyThreshold = Number(req.body.latencyThreshold) || 250;
    if (req.body.enabled !== undefined) changes.enabled = Boolean(req.body.enabled);
    if (!databaseReady) {
      const item = memoryWatchlist.find((entry) => entry._id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Watch target not found' });
      Object.assign(item, changes);
      return res.json(item);
    }
    const item = await WatchTargetModel.findByIdAndUpdate(req.params.id, changes, { new: true }).lean();
    if (!item) return res.status(404).json({ error: 'Watch target not found' });
    res.json(item);
  } catch (error) { next(error); }
});
app.post('/api/watchlist/check', async (_req, res, next) => { try { await checkAllTargets(); res.json(await getWatchlist()); } catch (error) { next(error); } });
app.get('/api/watchlist/:id/history', (req, res) => res.json(targetHistory.get(req.params.id) ?? []));
app.delete('/api/watchlist/:id', async (req, res, next) => {
  try {
    if (!databaseReady) {
      const index = memoryWatchlist.findIndex((item) => item._id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Watch target not found' });
      memoryWatchlist.splice(index, 1);
      targetHistory.delete(req.params.id);
    } else await WatchTargetModel.findByIdAndDelete(req.params.id);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/terminal/sessions', (_req, res) => res.json([...sessions.values()].map(publicSession)));
app.get('/api/sessions', (_req, res) => res.json([...sessions.values()].map(publicSession)));
app.post('/api/terminal/sessions', async (req, res, next) => {
  try {
    const protocol = (req.body.protocol ?? 'ssh') as TerminalProtocol;
    if (!['ssh', 'telnet', 'tcp', 'serial'].includes(protocol)) return res.status(400).json({ error: 'Unsupported terminal protocol' });
    const scrollback = Math.min(10000, Math.max(50, Number(req.body.scrollback) || 200));
    const savedCredential = req.body.savedCredential && typeof req.body.savedCredential === 'object'
      ? { id: req.body.savedCredential.id ? String(req.body.savedCredential.id) : undefined, label: req.body.savedCredential.label ? String(req.body.savedCredential.label) : undefined, username: req.body.savedCredential.username ? String(req.body.savedCredential.username) : undefined }
      : undefined;
    const config: TerminalConfig = {
      protocol, host: String(req.body.host ?? '').trim(),
      port: Number(req.body.port) || (protocol === 'ssh' ? 22 : protocol === 'telnet' ? 23 : protocol === 'serial' ? 9600 : 9000),
      username: String(req.body.username ?? ''), password: req.body.password ? String(req.body.password) : undefined,
      privateKey: req.body.privateKey ? String(req.body.privateKey) : undefined,
      privateKeyPath: req.body.privateKeyPath ? String(req.body.privateKeyPath) : undefined,
      passphrase: req.body.passphrase ? String(req.body.passphrase) : undefined,
      category: req.body.category ? String(req.body.category) : undefined, savedCredential, scrollback,
      logging: { enabled: req.body.logging?.enabled === true, path: req.body.logging?.path ? String(req.body.logging.path) : undefined },
      forwarding: req.body.forwarding && typeof req.body.forwarding === 'object' ? req.body.forwarding : undefined,
      baudRate: Number(req.body.baudRate) || (protocol === 'serial' ? Number(req.body.port) || 9600 : undefined),
      dataBits: req.body.dataBits ? Number(req.body.dataBits) as TerminalConfig['dataBits'] : undefined,
      stopBits: req.body.stopBits ? Number(req.body.stopBits) as TerminalConfig['stopBits'] : undefined,
      parity: req.body.parity ? String(req.body.parity) as TerminalConfig['parity'] : undefined,
    };
    if (!config.host) return res.status(400).json({ error: 'Host is required' });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: SessionRecord = { id, name: String(req.body.name || `${protocol.toUpperCase()} ${config.host}`), protocol, host: config.host, port: config.port!, username: config.username, category: config.category, savedCredential, scrollback, logging: { enabled: config.logging?.enabled === true, path: config.logging?.path }, forwarding: config.forwarding, status: 'connecting', createdAt: now, lastActivity: now, history: [], transport: new TerminalSession() };
    sessions.set(id, record);
    const writeHistory = (direction: 'in' | 'system', data: string) => { record.history.push({ direction, data, timestamp: new Date().toISOString() }); record.lastActivity = new Date().toISOString(); if (record.history.length > record.scrollback) record.history.splice(0, record.history.length - record.scrollback); void persistSession(record).catch(() => undefined); };
    record.transport.connect(config, (data) => writeHistory('in', data), (message) => { record.status = 'closed'; writeHistory('system', message ?? 'Disconnected'); });
    record.status = 'connected';
    await persistSession(record);
    addNetworkLog({ type: 'terminal-connect', sessionId: id, host: record.host, protocol });
    res.status(201).json(publicSession(record));
  } catch (error) { next(error); }
});
app.get('/api/terminal/sessions/:id/history', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session.history);
});
app.get('/api/sessions/:id/history', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session.history);
});
app.post('/api/terminal/sessions/:id/write', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const data = String(req.body.data ?? '');
  session.transport.write(data);
  session.history.push({ direction: 'out', data, timestamp: new Date().toISOString() });
  if (session.history.length > session.scrollback) session.history.splice(0, session.history.length - session.scrollback);
  session.lastActivity = new Date().toISOString();
  await persistSession(session);
  res.status(202).json({ ok: true });
});
app.delete('/api/terminal/sessions/:id', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.transport.close(); session.status = 'closed';
  await persistSession(session);
  res.status(204).end();
});

app.get('/api/terminal/sessions/:id/export', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const format = String(req.query.format ?? 'text').toLowerCase();
  if (format === 'json') return res.type('application/json').setHeader('Content-Disposition', `attachment; filename=${session.id}-transcript.json`).send(JSON.stringify(session.history, null, 2));
  if (format === 'csv') return res.type('text/csv').setHeader('Content-Disposition', `attachment; filename=${session.id}-transcript.csv`).send(toCsv(session.history as Array<Record<string, unknown>>));
  res.type('text/plain').setHeader('Content-Disposition', `attachment; filename=${session.id}-transcript.txt`).send(session.history.map((item) => `[${item.timestamp}] ${item.direction.toUpperCase()}\n${item.data}`).join('\n'));
});
app.get('/api/terminal/ws', (_req, res) => res.status(426).json({ error: 'WebSocket upgrade required', endpoint: 'ws://localhost:' + port + '/api/terminal/ws?sessionId=<id>', note: 'Create a session with POST /api/terminal/sessions first. REST write/history endpoints are available when WebSocket is unavailable.' }));

app.get('/api/search', async (req, res, next) => {
  try {
    const query = String(req.query.q ?? '').toLowerCase().trim();
    if (!query) return res.json([]);
    const targets = await getWatchlist();
    const result = [
      ...deviceCache.map((item) => ({ type: 'device', id: item.ip, title: item.ip, detail: item.mac })),
      ...targets.map((item) => ({ type: 'target', id: item._id, title: item.label || item.value, detail: item.value })),
      ...[...sessions.values()].map((item) => ({ type: 'session', id: item.id, title: item.name, detail: `${item.protocol}://${item.host}:${item.port}` })),
    ].filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(query));
    res.json(result);
  } catch (error) { next(error); }
});

function csvValue(value: unknown): string { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function toCsv(rows: Array<Record<string, unknown>>): string {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [keys.map(csvValue).join(','), ...rows.map((row) => keys.map((key) => csvValue(row[key])).join(','))].join('\r\n');
}
app.get('/api/export', async (req, res, next) => {
  try {
    const kind = String(req.query.type ?? 'network');
    const format = String(req.query.format ?? 'json').toLowerCase();
    const rows = kind === 'sessions'
      ? [...sessions.values()].map((item) => ({ ...publicSession(item), history: JSON.stringify(item.history) }))
      : kind === 'watchlist' ? await getWatchlist() : networkLogs;
    if (format === 'csv') { res.type('text/csv').setHeader('Content-Disposition', `attachment; filename=${kind}.csv`).send(toCsv(rows as Array<Record<string, unknown>>)); }
    else res.type('application/json').setHeader('Content-Disposition', `attachment; filename=${kind}.json`).send(JSON.stringify(rows, null, 2));
  } catch (error) { next(error); }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error instanceof Error ? error.message : 'Request failed' });
});

async function start(): Promise<void> {
  app.listen(port, () => console.log(`Sentinel API listening on http://localhost:${port}`));
  const mongoUrl = process.env.MONGODB_URI;
  if (mongoUrl) {
    try { await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 3000 }); databaseReady = true; await loadPersistedSessions(); console.log('MongoDB connected'); }
    catch (error) { console.warn(`MongoDB unavailable; using in-memory watchlist storage: ${error instanceof Error ? error.message : error}`); }
  } else console.log('MongoDB not configured; using in-memory watchlist storage.');
  setInterval(() => void checkAllTargets().catch(() => undefined), 30000);
}
void start();

export { app, checkAllTargets };
