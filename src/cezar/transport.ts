import { failure } from '../core/contracts.js';

export const HTTP_BYTES = 8 * 1024 * 1024;
export function requestScope(signals: (AbortSignal | undefined)[], timeoutMs?: number) {
  const controller = new AbortController();
  const listeners: (() => void)[] = [];
  for (const signal of signals) {
    if (!signal) continue;
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) abort();
    else { signal.addEventListener('abort', abort, { once: true }); listeners.push(() => signal.removeEventListener('abort', abort)); }
  }
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(new Error('deadline')), timeoutMs);
  return { signal: controller.signal, abort: () => controller.abort(), dispose: () => { if (timer) clearTimeout(timer); listeners.forEach(f => f()); } };
}
export async function readBounded(response: Response, maxBytes = HTTP_BYTES): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw failure('response_too_large', 'The cezar response exceeded the byte limit.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { throw failure('incompatible_server', 'The cezar response was not valid JSON.'); }
}
