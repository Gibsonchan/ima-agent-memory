'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../lib/config.cjs');
const events = require('../lib/events.cjs');
const { ImaStore } = require('../lib/ima.cjs');
const fixture = require('../examples/event.json');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-memory-cloud-test-'));
  t.after(() => { assert.ok(path.basename(root).startsWith('ima-memory-cloud-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  config.init(root); const c = { ...config.load(root), knowledge_base_id: 'synthetic-test-kb' };
  const notes = new Map(), calls = [];
  let counter = 0, failLink = false, corruptReadback = false;
  const api = async (endpoint, body) => {
    calls.push({ endpoint, body });
    if (endpoint.endsWith('import_doc')) {
      const id = `synthetic-note-${++counter}`, title = body.content.split('\n')[0].replace(/^# /, '');
      notes.set(id, { content: body.content, title, note_id: id, modify_time: counter });
      return { note_id: id };
    }
    if (endpoint.endsWith('get_doc_content')) {
      let content = notes.get(body.note_id).content;
      if (corruptReadback) content = content.replace(/sha256:[a-f0-9]{64}/, 'sha256:' + '0'.repeat(64));
      return { content };
    }
    if (endpoint.endsWith('add_knowledge')) {
      if (failLink) { failLink = false; throw new Error('Synthetic link failure'); }
      return { media_id: `synthetic-media-${counter}` };
    }
    if (endpoint.endsWith('search_note')) {
      const matched = [...notes.values()].filter(n => body.search_type === 0 ? n.title.includes(body.query_info.title) : n.content.toLowerCase().includes(body.query_info.content.toLowerCase()));
      return { search_note_infos: matched.slice(body.start, body.end).map(n => ({ note_book_info: n })), is_end: body.end >= matched.length };
    }
    throw new Error('Unexpected test endpoint');
  };
  return { root, c, notes, calls, store: new ImaStore(root, c, api), failNextLink() { failLink = true; }, corrupt() { corruptReadback = true; } };
}
test('sync preview makes zero API calls', async t => {
  const { store, calls } = setup(t);
  const result = await store.sync();
  assert.equal(result.dry_run, true); assert.equal(calls.length, 0);
});
test('all content is preflighted for secrets before the first cloud write', async t => {
  const { store, root, calls } = setup(t);
  fs.writeFileSync(path.join(root, 'curated', 'zzz.md'), 'sk-' + 'x'.repeat(24));
  await assert.rejects(store.sync({ apply: true }), /credential/);
  assert.equal(calls.length, 0);
});
test('sync reads back documents before publishing CURRENT, and skips unchanged snapshots', async t => {
  const { store, calls, notes } = setup(t);
  assert.equal((await store.sync({ apply: true })).manifest_verified, true);
  const imports = calls.filter(c => c.endpoint.endsWith('import_doc'));
  assert.match(imports.at(-1).body.content.split('\n')[0], /CURRENT/);
  assert.equal(imports.length, 4);
  const before = calls.length;
  await store.sync({ apply: true }); assert.equal(calls.length, before);
  assert.equal(notes.size, 4);
  const index = await store.current('demo');
  assert.equal(Object.keys(index.documents).length, 3);
  assert.match(await store.read('curated/projects/demo.md'), /empty template/);
});
test('failed linking preserves resumable state and does not advance success watermark', async t => {
  const x = setup(t); x.failNextLink();
  await assert.rejects(x.store.sync({ apply: true }), /Synthetic link failure/);
  const stateFile = fs.readdirSync(path.join(x.root, 'state')).find(n => n.endsWith('.json'));
  const state = config.readJson(path.join(x.root, 'state', stateFile));
  assert.equal(state.last_success_at, undefined);
  assert.equal(x.notes.size, 1);
  await x.store.sync({ apply: true }); assert.equal(x.notes.size, 4);
});
test('corrupt readback does not publish CURRENT or report success', async t => {
  const x = setup(t); x.corrupt();
  await assert.rejects(x.store.sync({ apply: true }), /integrity/);
  assert.equal([...x.notes.values()].some(n => n.title.includes('CURRENT')), false);
});
test('an existing lock remains in place after a rejected concurrent sync', async t => {
  const { root, store, calls } = setup(t), folder = path.join(root, 'state'); fs.mkdirSync(folder);
  const lock = path.join(folder, 'sync.lock'); fs.writeFileSync(lock, 'synthetic-lock');
  await assert.rejects(store.sync({ apply: true }), /locked/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'synthetic-lock'); assert.equal(calls.length, 0);
});
test('cloud candidates are verified, pulled idempotently, and excluded from search by default', async t => {
  const { store } = setup(t);
  const recorded = await store.record(fixture); assert.equal(recorded.accepted_as_candidate, true);
  await store.pullInbox(); await store.pullInbox(); assert.equal(store.queue()[0].candidates.length, 1);
  await store.sync({ apply: true });
  assert.equal((await store.search({ query: 'two languages', project: 'demo' })).results.length, 0);
  assert.equal((await store.search({ query: 'two languages', project: 'demo', include_candidates: true })).results.length, 1);
});
test('search excludes stale snapshots and other projects', async t => {
  const { store, root, c } = setup(t); c.projects.push({ id: 'second', name: 'Second' });
  fs.writeFileSync(path.join(root, 'curated', 'projects', 'demo.md'), '# Demo\nold-needle');
  fs.writeFileSync(path.join(root, 'curated', 'projects', 'second.md'), '# Second\nnew-needle');
  await store.sync({ apply: true });
  fs.writeFileSync(path.join(root, 'curated', 'projects', 'demo.md'), '# Demo\nnew-needle');
  await store.sync({ apply: true });
  assert.equal((await store.search({ query: 'old-needle', project: 'demo' })).results.length, 0);
  const result = await store.search({ query: 'new-needle', project: 'demo' });
  assert.equal(result.results.length, 1); assert.equal(result.results[0].project, 'demo');
});
test('manifest scope and document checksum must match the configured space', async t => {
  const { store } = setup(t);
  await store.sync({ apply: true });
  const index = await store.current();
  assert.throws(() => store.validateManifest({ ...index, memory_space_id: 'another-space' }), /does not belong/);
  assert.throws(() => store.validateManifest({ ...index, knowledge_base_id: 'another-kb' }), /does not belong/);
  const relative = 'curated/projects/demo.md'; index.documents[relative].hash = '0'.repeat(64);
  await assert.rejects(store.read(relative, index), /revision mismatch/);
  await assert.rejects(store.read('../config.json'), /current manifest/);
});
test('spaces sharing a credential cannot select each other\'s CURRENT by prefix', async t => {
  const { store, root, c } = setup(t); await store.sync({ apply: true });
  const other = new ImaStore(root, { ...c, memory_space_id: require('node:crypto').randomUUID() }, store.api);
  await assert.rejects(other.current(), /No CURRENT/);
});
