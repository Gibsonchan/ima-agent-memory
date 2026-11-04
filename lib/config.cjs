'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function validSlug(value) {
  return typeof value === 'string' && SLUG.test(value) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value);
}
function home(override) {
  return path.resolve(override || process.env.IMA_MEMORY_HOME || path.join(os.homedir(), '.local', 'share', 'ima-agent-memory'));
}
function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid relative document path');
  const target = path.resolve(root, ...relative.split('/'));
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Path escapes memory home');
  let current = path.resolve(root);
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are not allowed in memory data'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}
function readText(file) {
  if (fs.statSync(file).size > 1024 * 1024) throw new Error('Memory file exceeds 1 MiB');
  return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
}
function readJson(file) { return JSON.parse(readText(file)); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${randomUUID()}`;
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function validate(config) {
  if (config.schema_version !== 1 || !validSlug(config.namespace) || !/^[0-9a-f-]{36}$/.test(config.memory_space_id || '')) throw new Error('Invalid memory configuration');
  if (!['local', 'ima'].includes(config.backend)) throw new Error('backend must be local or ima');
  if (!Array.isArray(config.projects) || !config.projects.length || config.projects.some(p => !validSlug(p.id) || p.id === 'all' || p.id === 'global' || typeof p.name !== 'string' || !p.name.trim()) || new Set(config.projects.map(p => p.id)).size !== config.projects.length) throw new Error('Projects require unique safe IDs and names');
  if (config.backend === 'ima' && (typeof config.knowledge_base_id !== 'string' || !config.knowledge_base_id.trim())) throw new Error('Set knowledge_base_id before enabling ima');
  return config;
}
function load(root) { return validate(readJson(safePath(root, 'config.json'))); }
function init(root, { project = 'demo', name = 'Demo project' } = {}) {
  if (!validSlug(project) || ['all', 'global'].includes(project)) throw new Error('Invalid project ID');
  const source = path.resolve(__dirname, '..');
  if (root === source || root.startsWith(source + path.sep)) throw new Error('Choose a memory home outside the code repository');
  if (fs.existsSync(path.join(root, 'config.json'))) throw new Error('Memory home is already initialized; no files were replaced');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const config = { schema_version: 1, backend: 'local', namespace: 'AgentMemory'.toLowerCase(), memory_space_id: randomUUID(), knowledge_base_id: '', projects: [{ id: project, name }] };
  for (const relative of ['curated/00-entry.md', 'curated/01-preferences.md', 'curated/projects/demo.md']) {
    const target = relative.replace('projects/demo.md', `projects/${project}.md`);
    const file = safePath(root, target);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, fs.readFileSync(path.join(source, 'templates', relative)), { flag: 'wx', mode: 0o600 });
  }
  writeJson(safePath(root, 'config.json'), config);
  return { initialized: true, backend: 'local', home: root, project };
}
module.exports = { home, init, load, validate, validSlug, safePath, readText, readJson, writeJson };
