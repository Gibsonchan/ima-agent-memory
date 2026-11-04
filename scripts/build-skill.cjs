#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { parseArgs } = require('node:util');
const { hash } = require('../lib/events.cjs');
const { check } = require('./check-privacy.cjs');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const selected = relative => ['SKILL.md', 'LICENSE', 'SECURITY.md', 'scripts/memory.cjs', 'scripts/doctor.cjs', 'examples/event.json', 'examples/AGENTS-snippet.md'].includes(relative) || /^(bin|lib|templates|references)\//.test(relative);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const { name, bytes } of entries) {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(name) || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Unsafe archive path');
    const filename = Buffer.from(name), packed = zlib.deflateRawSync(bytes, { level: 9 }), crc = crc32(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, packed);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x800, 8); dir.writeUInt16LE(8, 10); dir.writeUInt16LE(33, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(bytes.length, 24); dir.writeUInt16LE(filename.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, filename); offset += local.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function build(output) {
  const files = check().filter(e => selected(e.path));
  if (!files.some(e => e.path === 'SKILL.md') || files.length > 300) throw new Error('Invalid skill file set');
  const entries = files.map(e => ({ name: e.path, bytes: fs.readFileSync(path.join(root, e.path)) }));
  const bytes = zip(entries);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Skill ZIP exceeds 10 MiB');
  const target = path.resolve(output);
  if (target === root || target.startsWith(root + path.sep)) throw new Error('Write release archives outside the source repository');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  return { version, file: target, files: entries.length, bytes: bytes.length, sha256: hash(bytes), skill_entry: 'SKILL.md', runtime_code_bundled: true, node_runtime_bundled: false, ima_skill_bundled: false, privacy_guard_passed: true };
}
if (require.main === module) {
  try { const { values } = parseArgs({ options: { output: { type: 'string' } } }); if (!values.output) throw new Error('Usage: node scripts/build-skill.cjs --output /path/outside/repo/skill.zip'); console.log(JSON.stringify(build(values.output), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { build, zip, crc32 };
