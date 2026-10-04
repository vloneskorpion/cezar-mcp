import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createMcpServer } from './mcp/server.js';
import { HttpCezarClient } from './cezar/http-client.js';
import { validateEndpoint } from './cezar/discovery.js';
import { VERSION } from './version.js';
export function parseArguments(args: string[], env: Record<string,string|undefined>) {
  let url: string | undefined; let readOnly = false;
  for (let i=0;i<args.length;i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '--version') { if (args.length !== 1) throw new Error(`${arg} must be used alone`); return { action:arg, readOnly }; }
    if (arg === '--read-only') readOnly = true;
    else if (arg === '--url') { if (url !== undefined || !args[i+1] || args[i+1]!.startsWith('--')) throw new Error('--url requires one loopback URL'); url = args[++i]; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  url ??= env.CEZAR_MCP_URL;
  if (url !== undefined) url = validateEndpoint(url);
  return { action:'serve',url,readOnly };
}
export async function main(args = process.argv.slice(2), env = process.env): Promise<void> {
  let options: ReturnType<typeof parseArguments>;
  try { options = parseArguments(args,env); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Invalid arguments'}\n`); process.exitCode=2; return; }
  if (options.action === '--version') { process.stdout.write(`${VERSION}\n`); return; }
  if (options.action === '--help') { process.stdout.write('Usage: cezar-mcp [--url <http://loopback-ip:port>] [--read-only]\nEndpoint: --url, then CEZAR_MCP_URL, then lazy discovery on ports 4321–4370.\n'); return; }
  const client = new HttpCezarClient({ url:options.url });
  const server = createMcpServer({ client,readOnly:options.readOnly });
  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing=true;
    client.close();
    process.stdin.off('end',shutdown); process.off('SIGINT',shutdown); process.off('SIGTERM',shutdown);
    await server.close();
    process.stdin.pause();
  };
  process.stdin.once('end',shutdown); process.once('SIGINT',shutdown); process.once('SIGTERM',shutdown);
  server.server.onerror = () => { process.stderr.write('MCP protocol error.\n'); };
  try { await server.connect(new StdioServerTransport()); } catch { process.stderr.write('Fatal MCP transport failure.\n'); process.exitCode=1; await shutdown(); }
}
