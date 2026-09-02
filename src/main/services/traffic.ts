import os from 'node:os';
import net from 'node:net';
import si from 'systeminformation';

export interface TrafficSample {
  timestamp: string;
  adapters: Array<{ name: string; rxBytesPerSec: number; txBytesPerSec: number }>;
  activeAdapters: number;
  addresses: number;
  protocolBreakdown: Array<{ protocol: string; connections: number; bytesPerSec: number }>;
  activeIps: Array<{ ip: string; connections: number; bytesPerSec: number }>;
}

/** Uses systeminformation's native adapters on Windows, macOS, and Linux. */
export async function sampleTraffic(): Promise<TrafficSample> {
  const interfaces = os.networkInterfaces();
  const entries = Object.values(interfaces).filter(Boolean);
  const addresses = entries.reduce((count, values) => count + (values?.length ?? 0), 0);
  let stats: Awaited<ReturnType<typeof si.networkStats>> = [];
  try { stats = await si.networkStats(); } catch { /* platform fallback below */ }
  let connections: Awaited<ReturnType<typeof si.networkConnections>> = [];
  try { connections = await si.networkConnections(); } catch { /* some platforms deny connection data */ }
  const protocolCounts = new Map<string, number>();
  const ipCounts = new Map<string, number>();
  for (const connection of connections) {
    const protocol = String(connection.protocol || 'TCP').toUpperCase();
    if (protocol !== 'TCP' && protocol !== 'UDP' && protocol !== 'ICMP') continue;
    const connectionData = connection as unknown as { remoteAddress?: string; peerAddress?: string; localAddress?: string };
    const ip = String(connectionData.remoteAddress || connectionData.peerAddress || connectionData.localAddress || '').trim();
    if (net.isIP(ip) > 0 && ip !== '0.0.0.0' && ip !== '::') {
      protocolCounts.set(protocol, (protocolCounts.get(protocol) ?? 0) + 1);
      ipCounts.set(ip, (ipCounts.get(ip) ?? 0) + 1);
    }
  }
  const fallbackBytes = stats.reduce((total, stat) => total + Math.max(0, stat.rx_sec || 0) + Math.max(0, stat.tx_sec || 0), 0);
  const totalIpConnections = [...ipCounts.values()].reduce((total, count) => total + count, 0);
  return {
    timestamp: new Date().toISOString(),
    adapters: stats.map((stat) => ({
      name: stat.iface,
      rxBytesPerSec: Math.max(0, stat.rx_sec || 0),
      txBytesPerSec: Math.max(0, stat.tx_sec || 0),
    })),
    activeAdapters: entries.filter((values) => values?.some((value) => !value.internal)).length,
    addresses,
    protocolBreakdown: [...protocolCounts.entries()].map(([protocol, count]) => ({ protocol, connections: count, bytesPerSec: Math.round(fallbackBytes * count / Math.max(connections.length, 1)) })),
    activeIps: [...ipCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([ip, count]) => ({ ip, connections: count, bytesPerSec: Math.round(fallbackBytes * count / Math.max(totalIpConnections, 1)) })),
  };
}
