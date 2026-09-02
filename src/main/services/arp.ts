import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ArpDevice {
  ip: string;
  mac: string;
  type: string;
}

/** Uses arp-scan when installed and falls back to the native arp table on Windows/macOS/Linux. */
export async function discoverArp(): Promise<ArpDevice[]> {
  const commands: Array<[string, string[]]> = process.platform === 'win32'
    ? [['arp', ['-a']]]
    : [['arp-scan', ['--localnet']], ['arp', ['-an']]];
  for (const [command, args] of commands) {
    try {
      const { stdout } = await execFileAsync(command, args as string[], { timeout: 6000, windowsHide: true });
      return parseArp(String(stdout));
    } catch {
      // Try the next compatible discovery command.
    }
  }
  return [];
}

function parseArp(text: string): ArpDevice[] {
  const found = new Map<string, ArpDevice>();
  const pattern = /(\d{1,3}(?:\.\d{1,3}){3}).{0,32}?(([0-9a-f]{2}[:-]){5}[0-9a-f]{2})/gi;
  for (const match of text.matchAll(pattern)) {
    const ip = match[1];
    const mac = match[2].replace(/-/g, ':').toUpperCase();
    if (!found.has(ip)) found.set(ip, { ip, mac, type: 'dynamic' });
  }
  return [...found.values()];
}
