#!/usr/bin/env node
'use strict';
// Supplementary source-release guard. It is not a general-purpose PII detector.
const fs = require('node:fs');
const path = require('node:path');
const { hash, checkSecrets } = require('../lib/events.cjs');
const root = path.resolve(__dirname, '..');
const exact = new Set(['.gitignore', '.gitattributes', 'package.json', 'README.md', 'README.en.md', 'SKILL.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', '.github/workflows/ci.yml']);
const allowed = relative => exact.has(relative) || /^(bin|lib|scripts)\/[a-z0-9-]+\.cjs$/.test(relative) || /^test\/[a-z0-9-]+\.test\.cjs$/.test(relative) || /^(docs|references)\/[a-z0-9-]+\.md$/.test(relative) || /^examples\/(event\.json|config\.example\.json|mcp-client\.example\.json|AGENTS-snippet\.md)$/.test(relative) || /^templates\/curated\/(00-entry\.md|01-preferences\.md|projects\/demo\.md)$/.test(relative);
function files(relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(item => {
    if (['.git', 'node_modules', 'coverage'].includes(item.name)) return [];
    const child = relative ? `${relative}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error(`Symlink in release: ${child}`);
    return item.isDirectory() ? files(child) : [child];
  });
}
function check() {
  const entries = [];
  for (const relative of files().sort()) {
    if (!allowed(relative)) throw new Error(`Unexpected release file: ${relative}`);
    const content = fs.readFileSync(path.join(root, relative));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    try { checkSecrets(text); } catch { throw new Error(`Possible credential or invalid Unicode: ${relative}`); }
    if (/[A-Z]:[\\/](?:Users|202[0-9]|Program Files)[\\/]|\/(?:Users|home)\/[a-zA-Z0-9_.-]+\//.test(text)) throw new Error(`Machine-specific path: ${relative}`);
    // Concrete cloud IDs and exported conversation IDs do not belong in source.
    if (/\bima_kb_[A-Za-z0-9]{6,}\b|\b01[a-f0-9]{6}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i.test(text)) throw new Error(`Possible private identifier: ${relative}`);
    entries.push({ path: relative, sha256: hash(content) });
  }
  return entries;
}
if (require.main === module) {
  try { const entries = check(); console.log(JSON.stringify({ passed: true, files: entries.length, note: 'Allowlist, UTF-8, common credential patterns, paths and private identifier checks passed; manual review is still required.' })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { check, allowed };
