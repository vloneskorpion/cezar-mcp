/** Importing this module creates no transport, network request or background work. */
export { VERSION } from './version.js';
export { createMcpServer } from './mcp/server.js';
export { HttpCezarClient } from './cezar/http-client.js';
export type { HttpClientOptions } from './cezar/http-client.js';
export { toolInputs, resultSchema, CezarError } from './core/contracts.js';
export type { TaskRef, WatchBaseline, ToolError, ResultEnvelope, ToolName, ToolInput } from './core/contracts.js';
export type { CezarClient, Connection, Run, HistoryPage, WaitResult } from './core/cezar-client.js';
