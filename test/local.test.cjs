'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const config = require('../lib/config.cjs');
const events = require('../lib/events.cjs');
const { LocalStore } = require('../lib/store.cjs');
const fixture = require('../examples/event.json');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-memory-test-'));
  t.after(() => { assert.ok(path.basename(root).startsWith('ima-memory-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  config.init(root); const c = config.load(root);
  return { root, c, store: new LocalStore(root, c) };
}
test('clean local initialization is offline, empty and refuses replacement', t => {
  const { root, c } = setup(t);
  assert.equal(c.backend, 'local');
  assert.equal(c.knowledge_base_id, '');
  assert.throws(() => config.init(root), /already initialized/);
  assert.equal(fs.existsSync(path.join(root, 'state')), false);
  assert.throws(() => config.init(path.resolve(__dirname, '..', 'data')), /outside/);
});
test('project and agent IDs cannot become traversal paths or reserved filenames', t => {
  const { c } = setup(t);
  for (const agent of ['../other', 'con', 'aux', 'a/b', 'a\\b', '..', 'NUL']) assert.throws(() => events.normalize({ ...fixture, agent }, c));
  for (const project of ['../other', 'all', 'global']) assert.throws(() => config.validate({ ...c, projects: [{ id: project, name: 'x' }] }));
});
test('events preserve Unicode, quotes and multiline data without self-promoting', t => {
  const { c } = setup(t);
  const e = events.normalize({ ...fixture, summary: '虚构测试："quotes" \\ **Markdown**\n第二行', status: 'accepted', identity_verified: true }, c);
  assert.equal(e.status, 'candidate'); assert.equal(e.identity_verified, false);
  assert.deepEqual(events.parse(events.format(e), c), e);
  assert.deepEqual(events.parse(events.format(e).replace(/\n/g, ''), c), e);
  assert.throws(() => events.parse(events.format(e).replace(/sha256:[a-f0-9]{64}/, 'sha256:' + '0'.repeat(64)), c), /integrity/);
  assert.throws(() => events.parse(events.format(e) + events.format(e), c), /ambiguous/);
  assert.throws(() => events.normalize({ ...fixture, summary: '\ud800' }, c), /Unicode/);
});
test('candidate IDs are immutable and repeated imports are idempotent', async t => {
  const { store, c } = setup(t), event = events.normalize(fixture, c);
  const saved = store.save(event); assert.deepEqual(store.save(event), saved);
  assert.throws(() => store.save({ ...event, summary: 'different' }), /different content/);
  assert.equal(store.queue().length, 1);
});
test('search requires an explicit scope and defaults to canonical documents', async t => {
  const { root, store, c } = setup(t);
  c.projects.push({ id: 'second', name: 'Second project' });
  fs.writeFileSync(path.join(root, 'curated', 'projects', 'demo.md'), '# Demo\nunique-needle in demo');
  fs.writeFileSync(path.join(root, 'curated', 'projects', 'second.md'), '# Second\nunique-needle in second');
  await store.record({ ...fixture, summary: 'unique-needle candidate' });
  await assert.rejects(store.search({ query: 'unique-needle' }), /Unknown project/);
  let r = await store.search({ query: 'unique-needle', project: 'demo' });
  assert.equal(r.results.length, 1); assert.equal(r.results[0].category, 'current_summary');
  r = await store.search({ query: 'unique-needle', project: 'all', include_candidates: true });
  assert.equal(r.results.length, 3);
  assert.ok(Object.values((await store.current('demo')).documents).every(d => ['demo', 'global'].includes(d.project)));
});
test('review records sources but never changes canonical summaries or candidates', async t => {
  const { store } = setup(t), before = await store.read('curated/projects/demo.md');
  const a = await store.record(fixture), b = await store.record({ ...fixture, agent: 'another-agent', summary: 'Fictional alternate statement' });
  assert.equal(store.queue()[0].candidates.length, 2);
  assert.throws(() => store.review(a.event_id, { status: 'accepted', note: '', source: '' }));
  const r = store.review(a.event_id, { status: 'accepted', note: 'Synthetic review', source: 'Synthetic source' });
  assert.equal(r.canonical_summary_changed, false);
  assert.equal(await store.read('curated/projects/demo.md'), before);
  assert.equal(store.queue()[0].candidates.find(e => e.event_id === a.event_id).status, 'candidate');
  assert.equal(store.queue()[0].candidates.find(e => e.event_id === b.event_id).review, null);
});
test('traversal, absolute paths and symlinked document trees are rejected', async t => {
  const { root, store } = setup(t);
  for (const p of ['../config.json', '/etc/passwd', 'curated/../config.json', 'curated\\projects\\demo.md', 'curated/./projects/demo.md']) assert.throws(() => config.safePath(root, p));
  await assert.rejects(store.read('config.json'), /current manifest/);
  const target = path.join(root, 'outside'); fs.mkdirSync(target);
  const link = path.join(root, 'curated', 'linked');
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.diagnostic('Symlink creation unavailable; traversal assertions still ran'); return; } throw e; }
  assert.throws(() => store.snapshot(), /Symbolic links/);
});
test('common credentials and malformed UTF-8 are rejected', t => {
  const { root, c } = setup(t);
  const suspect = ['sk-' + 'a'.repeat(24), 'ghp_' + 'b'.repeat(24), 'Bearer ' + 'c'.repeat(24), 'api' + '_key=' + 'd'.repeat(16)];
  for (const summary of suspect) assert.throws(() => events.normalize({ ...fixture, summary }, c), /credential/);
  const file = path.join(root, 'bad.md'); fs.writeFileSync(file, Buffer.from([0xff, 0xfe]));
  assert.throws(() => config.readText(file));
});
test('quick-start CLI works from an unrelated working directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-memory-test-'));
  t.after(() => { assert.ok(path.basename(root).startsWith('ima-memory-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  const cli = path.resolve(__dirname, '..', 'bin', 'ima-agent-memory.cjs');
  const run = args => execFileSync(process.execPath, [cli, ...args, '--home', root], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(run(['init'])).backend, 'local');
  const event = JSON.parse(run(['record', '--file', path.resolve(__dirname, '..', 'examples', 'event.json')]));
  assert.ok(event.event_id);
  const result = JSON.parse(run(['search', 'two languages', '--project', 'demo', '--include-candidates']));
  assert.equal(result.results.length, 1);
  const mcp = JSON.parse(run(['mcp-config']));
  assert.equal(mcp.mcpServers.agent_memory.command, process.execPath);
  assert.equal(mcp.mcpServers.agent_memory.env.IMA_MEMORY_HOME, root);
});
