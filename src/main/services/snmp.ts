import * as snmp from 'net-snmp';

export interface SnmpValue {
  oid: string;
  value: string | number;
}

export interface SnmpOptions {
  host: string;
  version?: '2c' | '3';
  community?: string;
  user?: { name: string; level?: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv'; authKey?: string; privKey?: string };
  oids?: string[];
  timeout?: number;
}

export function pollSnmp(options: SnmpOptions): Promise<SnmpValue[]> {
  const { host, community = 'public', oids = ['1.3.6.1.2.1.1.1.0'], timeout = 2000 } = options;
  return new Promise((resolve, reject) => {
    const session = options.version === '3' && options.user
      ? snmp.createV3Session(host, {
        name: options.user.name,
        level: options.user.level ?? snmp.SecurityLevel.noAuthNoPriv,
        authProtocol: snmp.AuthProtocols.sha,
        authKey: options.user.authKey,
        privProtocol: snmp.PrivProtocols.des,
        privKey: options.user.privKey,
      }, { timeout, retries: 0 })
      : snmp.createSession(host, community, { timeout, retries: 0 });
    session.get(oids, (error: Error | null, varbinds: Array<{ oid: string; value: unknown }>) => {
      session.close();
      if (error) return reject(error);
      resolve(varbinds.map((entry) => ({
        oid: entry.oid,
        value: typeof entry.value === 'number' || typeof entry.value === 'string' ? entry.value : String(entry.value),
      })));
    });
  });
}
