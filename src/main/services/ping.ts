import ping from 'ping';
import net from 'node:net';

export interface PingResult {
  host: string;
  alive: boolean;
  time: number | null;
  output: string;
}

export async function pingHost(host: string, timeout = 2): Promise<PingResult> {
  const result = await ping.promise.probe(host, { timeout, min_reply: 1 });
  const parsed = Number.parseFloat(String(result.time));
  return {
    host,
    alive: result.alive,
    time: Number.isFinite(parsed) ? parsed : null,
    output: result.output,
  };
}

export async function pingSweep(hosts: string[], concurrency = 8): Promise<PingResult[]> {
  const results: PingResult[] = [];
  for (let index = 0; index < hosts.length; index += concurrency) {
    const batch = hosts.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(async (host) => {
      try {
        return await pingHost(host);
      } catch (error) {
        return { host, alive: false, time: null, output: error instanceof Error ? error.message : 'Ping failed' };
      }
    })))); 
  }
  return results;
}

export function checkTcpPort(host: string, port: number, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
