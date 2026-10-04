import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('library import emits no output and opens no network connection', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    globalThis.fetch = () => { throw new Error('network during import'); };
    const { VERSION } = await import('./src/index.ts');
    if (VERSION !== '0.1.0') throw new Error('version');
    const handles = process._getActiveHandles().filter(h => ![process.stdin, process.stdout, process.stderr].includes(h));
    if (handles.length) throw new Error('active handles during import');
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
