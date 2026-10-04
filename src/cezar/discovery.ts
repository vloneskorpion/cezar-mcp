import { isIP } from 'node:net';
import { failure, CezarError } from '../core/contracts.js';
import { healthWire } from './wire.js';
import { parseJson, readBounded, requestScope } from './transport.js';

export function validateEndpoint(value: string): string {
  try {
    const raw = /^http:\/\/(\[[^\]]+\]|[^/:?#]+)(?::\d+)?\/?$/.exec(value);
    if (!raw) throw new Error('origin required');
    const host = raw[1]!.replace(/^\[|\]$/g, '');
    if (!isIP(host) || !(host === '::1' || (isIP(host) === 4 && host.startsWith('127.')))) throw new Error('loopback literal required');
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('origin required');
    return url.origin;
  } catch { throw failure('invalid_endpoint', 'Use an HTTP loopback IP origin, such as http://127.0.0.1:4321; DNS names, redirects and credentials are unsupported.'); }
}
export interface DiscoveryOptions { fetch?: typeof fetch; signal?: AbortSignal; deadlineMs?: number; probeMs?: number }
export async function discoverEndpoint(options: DiscoveryOptions = {}): Promise<string> {
  const scope = requestScope([options.signal], options.deadlineMs ?? 10_000);
  const request = options.fetch ?? globalThis.fetch;
  const candidates: string[] = [];
  let nextPort = 4321;
  let completed = 0;
  try {
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (nextPort <= 4370 && !scope.signal.aborted) {
        const port = nextPort++;
        const probe = requestScope([scope.signal], options.probeMs ?? 800);
        try {
          const response = await request(`http://127.0.0.1:${port}/api/v1/health`, { signal: probe.signal, redirect: 'error' });
          if (response.ok && healthWire.safeParse(parseJson(await readBounded(response))).success) candidates.push(`http://127.0.0.1:${port}`);
          else await response.body?.cancel().catch(() => {});
        } catch { /* Refused/malformed individual candidates are not a cockpit. */ }
        finally { probe.dispose(); completed++; }
      }
    }));
    if (scope.signal.aborted || completed !== 50) throw failure('discovery_incomplete', 'Discovery did not complete; select a cockpit with --url.');
    if (candidates.length > 1) throw failure('ambiguous_server', `Multiple cockpits found: ${candidates.sort().slice(0, 50).join(', ')}. Select one with --url.`);
    if (candidates.length === 0) throw failure('server_unavailable', 'No cezar cockpit found. Start cezar serve, or select its loopback URL.');
    return candidates[0]!;
  } catch (error) {
    if (error instanceof CezarError) throw error;
    throw failure('server_unavailable', 'Cezar discovery failed.');
  } finally { scope.abort(); scope.dispose(); }
}
