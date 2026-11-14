import { connect } from 'net';

export const VIRUS_SCANNER = Symbol('VIRUS_SCANNER');
export interface ScanResult { status: 'CLEAN' | 'INFECTED' | 'ERROR'; engine: string; signature?: string }
export interface VirusScanner { scan(bytes: Buffer): Promise<ScanResult> }

/** Standard EICAR antivirus test string (harmless; every scanner flags it). */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Offline scanner: flags EICAR and obviously malformed / executable payloads, ERROR on empty input. */
export class MockVirusScanner implements VirusScanner {
  scan(bytes: Buffer): Promise<ScanResult> {
    const engine = 'mock-scanner';
    if (bytes.length === 0) return Promise.resolve({ status: 'ERROR', engine });
    if (bytes.includes(Buffer.from(EICAR))) return Promise.resolve({ status: 'INFECTED', engine, signature: 'Eicar-Test-Signature' });
    const head = bytes.subarray(0, 4);
    const exe = (head[0] === 0x4d && head[1] === 0x5a) || (head[0] === 0x7f && head.toString('latin1', 1, 4) === 'ELF') || head.toString('latin1', 0, 2) === '#!';
    if (exe) return Promise.resolve({ status: 'INFECTED', engine, signature: 'Heuristic.Executable' });
    return Promise.resolve({ status: 'CLEAN', engine });
  }
}

/** Real scanner: clamd INSTREAM over TCP (CLAMAV_HOST / CLAMAV_PORT). Fails closed (ERROR) when clamd is unreachable. */
export class ClamAvScanner implements VirusScanner {
  constructor(private host: string, private port: number, private timeoutMs = 20_000) {}

  scan(bytes: Buffer): Promise<ScanResult> {
    const engine = 'clamav';
    return new Promise((resolve) => {
      let out = '';
      const sock = connect({ host: this.host, port: this.port });
      const done = (r: ScanResult) => { sock.destroy(); resolve(r); };
      sock.setTimeout(this.timeoutMs, () => done({ status: 'ERROR', engine }));
      sock.on('error', () => done({ status: 'ERROR', engine }));
      sock.on('data', (d) => { out += d.toString(); });
      sock.on('end', () => {
        // e.g. "stream: OK\0" or "stream: Eicar-Test-Signature FOUND\0"
        const line = out.replace(/\0/g, '').trim();
        if (/OK$/.test(line)) return resolve({ status: 'CLEAN', engine });
        const m = /stream:\s*(.+)\s+FOUND$/.exec(line);
        resolve(m ? { status: 'INFECTED', engine, signature: m[1] } : { status: 'ERROR', engine });
      });
      sock.on('connect', () => {
        sock.write('zINSTREAM\0');
        for (let i = 0; i < bytes.length; i += 64 * 1024) {
          const chunk = bytes.subarray(i, i + 64 * 1024);
          const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
          sock.write(len); sock.write(chunk);
        }
        sock.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
      });
    });
  }
}
