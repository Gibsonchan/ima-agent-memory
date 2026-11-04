'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { build, crc32 } = require('../scripts/build-skill.cjs');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-memory-skill-test-'));
  t.after(() => { assert.ok(path.basename(root).startsWith('ima-memory-skill-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
test('skill ZIP installs offline with all runtime files and templates', t => {
  const root = setup(t), target = path.join(root, 'skill.zip'), installed = path.join(root, 'installed skill with spaces');
  const result = build(target); assert.ok(result.bytes < 10 * 1024 * 1024);
  const bytes = fs.readFileSync(target), names = []; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 8);
    const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + length).toString('utf8');
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
    const start = offset + 30 + length + extra, content = zlib.inflateRawSync(bytes.subarray(start, start + size));
    assert.equal(content.length, bytes.readUInt32LE(offset + 22));
    const file = path.join(installed, ...name.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
    names.push(name); offset = start + size;
  }
  assert.equal(names.filter(n => path.posix.basename(n) === 'SKILL.md').length, 1);
  assert.ok(names.includes('SKILL.md'));
  assert.ok(!names.some(n => /^(?:\.git|state|curated)\//.test(n) || n === 'config.json' || n.endsWith('.zip')));
  assert.match(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'), /^---\nname: ima-agent-memory\n/);
  const cli = path.join(installed, 'scripts', 'memory.cjs'), memory = path.join(root, 'private data');
  const run = args => execFileSync(process.execPath, [cli, ...args, '--home', memory], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(run(['init'])).backend, 'local');
  assert.match(run(['read', 'curated/projects/demo.md']), /empty template/);
  const saved = JSON.parse(run(['record', '--file', path.join(installed, 'examples', 'event.json')])); assert.equal(saved.accepted_as_candidate, true);
  const found = JSON.parse(run(['search', 'two languages', '--project', 'demo', '--include-candidates'])); assert.equal(found.results.length, 1);
  const second = path.join(root, 'second.zip'); build(second); assert.deepEqual(fs.readFileSync(second), bytes);
});
test('doctor is read-only and never emits credential values', t => {
  const root = setup(t), memory = path.join(root, 'private home');
  const doctor = path.resolve(__dirname, '..', 'scripts', 'doctor.cjs');
  const env = { ...process.env };
  env['IMA_OPENAPI_' + 'CLIENTID'] = 'synthetic-private-client';
  env['IMA_OPENAPI_' + 'APIKEY'] = 'synthetic-private-credential';
  const run = () => execFileSync(process.execPath, [doctor, '--home', memory], { encoding: 'utf8', windowsHide: true, env });
  const first = JSON.parse(run()); assert.equal(first.memory_initialized, false); assert.equal(fs.existsSync(memory), false); assert.equal(first.network_requests, 0); assert.equal(first.files_written, 0);
  require('../lib/config.cjs').init(memory);
  const output = run(), result = JSON.parse(output); assert.equal(result.ima_credentials_detected, true); assert.equal(result.config_valid, true);
  assert.ok(!output.includes('synthetic-private-client') && !output.includes('synthetic-private-credential'));
});
test('ZIP checksum matches a published standard CRC32 vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});
