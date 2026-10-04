#!/usr/bin/env node
import { main } from './cli.js';
main().catch(() => { process.stderr.write('Fatal cezar-mcp process failure.\n'); process.exitCode = 1; });
