#!/usr/bin/env node
import { VERSION } from './index.js';
if (process.argv.includes('--version')) process.stdout.write(`${VERSION}\n`);
else if (process.argv.includes('--help')) process.stdout.write('Usage: cezar-mcp [--url <loopback-url>] [--read-only]\n');
else { process.stderr.write('cezar-mcp transport is being implemented.\n'); process.exitCode = 1; }
