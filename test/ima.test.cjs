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
function setup(t, { flattenReadback = false, truncateTitles = false, appendTitlePreview = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-memory-cloud-test-'));
  t.after(() => { assert.ok(path.basename(root).startsWith('ima-memory-cloud-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  config.init(root); const c = { ...config.load(root), knowledge_base_id: 'synthetic-test-kb' };
  const notes = new Map(), calls = [];
  let counter = 0, failLink = false, corruptReadback = false, loseReceipt = false;
  const api = async (endpoint, body) => {
    calls.push({ endpoint, body });
    if (endpoint.endsWith('import_doc')) {
      const id = `synthetic-note-${++counter}`, title = body.content.split('\n')[0].replace(/^# /, '');
      notes.set(id, { content: body.content, title, note_id: id, modify_time: counter });
      if (loseReceipt) { loseReceipt = false; throw new Error('Synthetic import timeout'); }
      return { note_id: id };
    }
    if (endpoint.endsWith('get_doc_content')) {
      let content = notes.get(body.note_id).content;
      if (corruptReadback) content = content.replace(/sha256:[a-f0-9]{64}/, 'sha256:' + '0'.repeat(64));
      return { content: flattenReadback ? content.replace(/\r?\n/g, '') : content };
    }
    if (endpoint.endsWith('add_knowledge')) {
      if (failLink) { failLink = false; throw new Error('Synthetic link failure'); }
      return { media_id: `synthetic-media-${counter}` };
    }
    if (endpoint.endsWith('search_note')) {
      const matched = [...notes.values()].filter(n => body.search_type === 0 ? n.title.includes(body.query_info.title.trim()) : n.content.toLowerCase().includes(body.query_info.content.toLowerCase()));
      const results = matched.slice(body.start, body.end).map(n => {
        const title = appendTitlePreview ? `${n.title} preview text` : n.title;
        return { note_book_info: { ...n, title: truncateTitles && title.length > 30 ? title.slice(0, 27) + '...' : title } };
      });
      return { search_note_infos: results, is_end: body.end >= matched.length };
    }
    throw new Error('Unexpected test endpoint');
  };
  return { root, c, notes, calls, store: new ImaStore(root, c, api), failNextLink() { failLink = true; }, corrupt() { corruptReadback = true; }, loseNextReceipt() { loseReceipt = true; } };
}
test('sync preview makes zero API calls', async t => {
  const { store, calls } = setup(t);
  const result = await store.sync();
  assert.equal(result.dry_run, true); assert.equal(calls.length, 0);
});
test('all content is preflighted for secrets before the first cloud write', async t => {
  const { store, root, calls } = setup(t);
  fs.writeFileSync(path.join(root, 'curated', 'projects', 'demo.md'), 'sk-' + 'x'.repeat(24));
  await assert.rejects(store.sync({ apply: true }), /credential/);
  assert.equal(calls.length, 0);
});
test('sync reads back documents before publishing CURRENT, and skips unchanged snapshots', async t => {
  const { store, calls, notes } = setup(t);
  assert.equal((await store.sync({ apply: true })).manifest_verified, true);
  const imports = calls.filter(c => c.endpoint.endsWith('import_doc'));
  assert.ok(imports.at(-1).body.content.startsWith(`# ${store.currentPrefix} `));
  assert.equal(imports.length, 4);
  const before = calls.length;
  await store.sync({ apply: true }); assert.equal(calls.length, before);
  assert.equal(notes.size, 4);
  const index = await store.current('demo');
  assert.equal(Object.keys(index.documents).length, 3);
  assert.match(await store.read('curated/projects/demo.md'), /empty template/);
});
test('short cloud titles and original Markdown survive IMA title truncation and single-line readback', async t => {
  const { store, root, notes } = setup(t, { flattenReadback: true, truncateTitles: true, appendTitlePreview: true });
  const markdown = '# Project\n\n- 中文 `literal`\n';
  fs.writeFileSync(path.join(root, 'curated', 'projects', 'demo.md'), markdown);
  await store.sync({ apply: true });
  assert.equal((await store.current()).stale, false);
  assert.equal(await store.read('curated/projects/demo.md'), markdown);
  const candidate = await store.record(fixture);
  assert.equal((await store.pullInbox()).candidates[0].event_id, candidate.event_id);
  assert.ok([...notes.values()].filter(n => n.title.startsWith('am')).every(n => n.title.length <= 30));
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
  assert.equal([...x.notes.values()].some(n => n.title.startsWith(`${x.store.currentPrefix} `)), false);
});
test('an existing lock remains in place after a rejected concurrent sync', async t => {
  const { root, store, calls } = setup(t), folder = path.join(root, 'state'); fs.mkdirSync(folder);
  const lock = path.join(folder, 'sync.lock'); fs.writeFileSync(lock, 'synthetic-lock');
  await assert.rejects(store.sync({ apply: true }), /locked/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'synthetic-lock'); assert.equal(calls.length, 0);
});
test('cloud candidates are verified, pulled idempotently, and excluded from search by default', async t => {
  const { root, store } = setup(t);
  const recorded = await store.record(fixture); assert.equal(recorded.accepted_as_candidate, true);
  await store.pullInbox(); await store.pullInbox(); assert.equal(store.queue()[0].candidates.length, 1);
  fs.writeFileSync(path.join(root, 'curated', 'private.md'), 'unlisted fixture');
  await store.sync({ apply: true });
  assert.equal(Object.keys((await store.current()).documents).length, 3);
  assert.equal((await store.search({ query: 'two languages', project: 'demo' })).results.length, 0);
  assert.equal((await store.search({ query: 'two languages', project: 'demo', include_candidates: true })).results.length, 1);
});
test('publisher pin can be shared without the signing key, and the verified generation cannot roll back', async t => {
  const { root, c, store, notes } = setup(t);
  const first = await store.sync({ apply: true }), previousNotes = new Map(notes);
  fs.writeFileSync(path.join(root, 'curated', 'projects', 'demo.md'), '# New fixture');
  const next = await store.sync({ apply: true });
  assert.ok(next.generation > first.generation);
  const reader = path.join(root, 'separate-reader'), other = new ImaStore(reader, c, store.api);
  await assert.rejects(other.current(), /publisher pin/);
  other.trust.pinPublisher(store.trust.exportPin());
  assert.equal((await other.current()).generation, next.generation);
  await assert.rejects(other.sync({ apply: true }), /signing key/);
  for (const [id, note] of notes) if (note.title.startsWith(`${store.currentPrefix} `) && !previousNotes.has(id)) notes.delete(id);
  const restored = await new ImaStore(reader, c, store.api).current();
  assert.equal(restored.generation, next.generation);
  assert.equal(restored.stale, true);
  const signed = store.trust.lastGood();
  assert.throws(() => store.trust.open({ ...signed, manifest: { ...signed.manifest, generation: next.generation + 1 } }), /signature/);
});
test('bad candidates enter quarantine without blocking valid inbox records', async t => {
  const { store, notes } = setup(t), title = `${store.inboxPrefix} synthetic`;
  notes.set('invalid-fixture', { title, content: 'Unstructured fixture', note_id: 'invalid-fixture' });
  const event = await store.record(fixture), pulled = await store.pullInbox();
  assert.equal(pulled.candidates[0].event_id, event.event_id);
  assert.deepEqual(pulled.quarantined, [{ note_id: 'invalid-fixture', reason: 'invalid_candidate' }]);
});
test('an upgraded inbox reads a legacy record by full body heading despite abbreviated title metadata', async t => {
  const { c, store, notes } = setup(t, { flattenReadback: true, truncateTitles: true });
  const event = events.normalize(fixture, c), title = `${store.prefix} · INBOX · ${event.event_id}`;
  notes.set('legacy-candidate', { title, content: `${title}\n\n${events.format(event)}`, note_id: 'legacy-candidate' });
  const pulled = await store.pullInbox();
  assert.equal(pulled.candidates[0].event_id, event.event_id);
  assert.deepEqual(pulled.quarantined, []);
});
test('signed legacy CURRENT remains readable and sync republishes just the short index', async t => {
  const { root, c, store, notes } = setup(t, { flattenReadback: true, truncateTitles: true });
  const first = await store.sync({ apply: true });
  const oldNote = [...notes.values()].find(n => n.title.startsWith(`${store.currentPrefix} `));
  const legacyTitle = `${store.prefix} · CURRENT · G${String(first.generation).padStart(16, '0')} · 2026-01-01`;
  oldNote.content = oldNote.content.replace(`# ${oldNote.title}`, legacyTitle);
  oldNote.title = legacyTitle;
  const stateFile = fs.readdirSync(path.join(root, 'state')).find(name => name.startsWith('sync-') && name.endsWith('.json'));
  const file = path.join(root, 'state', stateFile), state = config.readJson(file);
  delete state.pending_manifest.title_format;
  state.documents.CURRENT.title = legacyTitle;
  config.writeJson(file, state);
  const reader = new ImaStore(path.join(root, 'separate-reader'), c, store.api);
  reader.trust.pinPublisher(store.trust.exportPin());
  assert.equal((await reader.current()).generation, first.generation);
  const before = notes.size;
  assert.ok((await store.sync({ apply: true })).generation > first.generation);
  assert.equal(notes.size, before + 1);
  assert.equal([...notes.values()].filter(n => n.title.startsWith(`${store.currentPrefix} `)).length, 1);
});
test('a retried candidate submission reuses its known note after a link failure', async t => {
  const { store, notes, failNextLink } = setup(t), input = { ...fixture, request_id: 'synthetic-request' };
  failNextLink();
  await assert.rejects(store.record(input), /Synthetic link failure/);
  const saved = await store.record(input);
  assert.deepEqual(await store.record(input), saved);
  assert.equal(notes.size, 1);
  await assert.rejects(store.record({ ...input, summary: 'Other fixture' }), /different content/);
});
test('an import timeout reconciles the existing note even when IMA abbreviates long titles', async t => {
  const { store, notes, loseNextReceipt } = setup(t, { flattenReadback: true, truncateTitles: true, appendTitlePreview: true });
  const input = { ...fixture, request_id: 'synthetic-import-timeout' };
  loseNextReceipt();
  await assert.rejects(store.record(input), /timeout/);
  const saved = await store.record(input);
  assert.equal(saved.accepted_as_candidate, true);
  assert.equal(notes.size, 1);
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
