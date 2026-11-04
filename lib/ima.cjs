'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { safePath, readJson, readText, writeJson } = require('./config.cjs');
const { LocalStore, checkProject } = require('./store.cjs');
const events = require('./events.cjs');
const exec = promisify(execFile);

function makeApi(config) {
  return async (endpoint, body) => {
    const skillDir = process.env.IMA_SKILL_DIR || config.ima_skill_dir;
    if (!skillDir || !path.isAbsolute(skillDir) || !fs.existsSync(path.join(skillDir, 'ima_api.cjs'))) throw new Error('Set IMA_SKILL_DIR to the absolute directory of the official ima-skill (containing ima_api.cjs)');
    events.utf8(JSON.stringify(body));
    let result;
    try {
      result = await exec(process.execPath, [path.join(skillDir, 'ima_api.cjs'), endpoint, JSON.stringify(body), JSON.stringify({ baseUrl: 'https://ima.qq.com' })], { windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
      let message = error.killed ? 'ima request timed out' : 'Official ima helper failed; check credentials, network and skill updates';
      try { const j = JSON.parse(error.stderr); if (typeof j.msg === 'string') message = j.msg.slice(0, 500); } catch {}
      throw new Error(message);
    }
    let response;
    try { response = JSON.parse(result.stdout); } catch { throw new Error('ima helper returned an unexpected response'); }
    if (response.code !== 0) throw new Error(`ima request failed (${response.code}); ${String(response.msg || 'unknown error').slice(0, 300)}`);
    return response.data;
  };
}
class ImaStore extends LocalStore {
  constructor(root, config, api = makeApi(config)) {
    super(root, config);
    if (!config.knowledge_base_id) throw new Error('Set knowledge_base_id to your own ima knowledge base');
    this.api = api;
    this.prefix = `${config.namespace} · ${config.memory_space_id}`;
  }
  async findNotes(title) {
    const found = [];
    for (let start = 0; start < 2000; start += 20) {
      const data = await this.api('openapi/note/v1/search_note', { search_type: 0, sort_type: 0, query_info: { title }, start, end: start + 20 });
      if (!Array.isArray(data.search_note_infos)) throw new Error('Unexpected ima search response');
      found.push(...data.search_note_infos.map(x => x.note_book_info).filter(x => x && typeof x.title === 'string' && x.title.startsWith(title)));
      if (data.is_end === true) return found;
    }
    throw new Error('ima search exceeded the page limit; narrow the memory namespace');
  }
  async getNote(id) {
    const result = await this.api('openapi/note/v1/get_doc_content', { note_id: id, target_content_format: 0 });
    if (typeof result.content !== 'string') throw new Error('ima note has no text content');
    return result.content;
  }
  validateManifest(manifest) {
    if (manifest.schema_version !== 1 || manifest.memory_space_id !== this.config.memory_space_id || manifest.knowledge_base_id !== this.config.knowledge_base_id || !manifest.documents || typeof manifest.documents !== 'object' || Array.isArray(manifest.documents)) throw new Error('Manifest does not belong to this memory space and knowledge base');
    for (const [relative, doc] of Object.entries(manifest.documents)) {
      safePath(this.root, relative);
      if (!relative.startsWith('curated/') || !relative.endsWith('.md') || typeof doc.note_id !== 'string' || !/^[0-9a-f]{64}$/.test(doc.hash)) throw new Error('Invalid document in cloud manifest');
      Object.assign(doc, require('./store.cjs').meta(relative));
    }
    return manifest;
  }
  async current(project) {
    checkProject(this.config, project, true);
    const notes = await this.findNotes(`${this.prefix} · CURRENT ·`);
    notes.sort((a, b) => Number(b.modify_time) - Number(a.modify_time));
    if (!notes.length) throw new Error('No CURRENT manifest; run sync --apply from the maintainer machine first');
    const result = this.validateManifest(events.unpack('MANIFEST_V1', await this.getNote(notes[0].note_id)));
    if (project && project !== 'all') result.documents = Object.fromEntries(Object.entries(result.documents).filter(([, d]) => d.project === project || d.project === 'global'));
    return result;
  }
  async read(document, manifest) {
    const index = manifest || await this.current();
    if (!Object.hasOwn(index.documents, document)) throw new Error('Document is not in the current manifest');
    const doc = index.documents[document];
    const payload = events.unpack('DOCUMENT_V1', await this.getNote(doc.note_id));
    if (payload.document !== document || payload.memory_space_id !== this.config.memory_space_id || typeof payload.content !== 'string' || events.hash(payload.content) !== doc.hash) throw new Error('Cloud document revision mismatch');
    return payload.content;
  }
  async search(args) {
    const { query, project, agent, include_candidates = false, offset = 0 } = args;
    checkProject(this.config, project);
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || !Number.isInteger(offset) || offset < 0 || (agent !== undefined && !require('./config.cjs').validSlug(agent)) || typeof include_candidates !== 'boolean') throw new Error('Invalid search arguments');
    const manifest = await this.current(project);
    const allowed = Object.entries(manifest.documents).filter(([, d]) => (!agent || agent === d.agent) && (include_candidates || d.category !== 'candidate'));
    const results = [], seen = new Set();
    let cursor = offset, isEnd = false;
    for (let pages = 0; pages < 5; pages++) {
      const data = await this.api('openapi/note/v1/search_note', { search_type: 1, sort_type: 0, query_info: { content: query }, start: cursor, end: cursor + 20 });
      if (!Array.isArray(data.search_note_infos)) throw new Error('Unexpected ima search response');
      for (const item of data.search_note_infos) {
        const match = allowed.find(([, d]) => d.note_id === item.note_book_info?.note_id);
        if (!match || seen.has(match[0])) continue;
        seen.add(match[0]);
        const [document, doc] = match, text = await this.read(document, manifest), i = text.toLowerCase().indexOf(query.toLowerCase());
        if (i >= 0) results.push({ document, ...doc, excerpt: text.slice(Math.max(0, i - 120), i + 700) });
      }
      cursor += 20; isEnd = data.is_end === true;
      if (isEnd || results.length >= 8) break;
    }
    return { project, results, next_offset: isEnd ? null : cursor, candidates_included: include_candidates, scope: 'current_manifest_only' };
  }
  async record(input) {
    const event = events.normalize(input, this.config);
    const title = `${this.prefix} · INBOX · ${event.event_id}`, content = `# ${title}\n\n${events.format(event)}`;
    const result = await this.api('openapi/note/v1/import_doc', { content_format: 1, content });
    if (!result.note_id) throw new Error('ima did not return a note ID');
    const saved = events.parse(await this.getNote(result.note_id), this.config);
    if (JSON.stringify(saved) !== JSON.stringify(event)) throw new Error('Candidate readback verification failed');
    await this.api('openapi/wiki/v1/add_knowledge', { media_type: 11, note_info: { content_id: result.note_id }, title, knowledge_base_id: this.config.knowledge_base_id });
    return { accepted_as_candidate: true, event_id: event.event_id, identity_verified: false, canonical_summary_changed: false };
  }
  async pullInbox() {
    const notes = await this.findNotes(`${this.prefix} · INBOX ·`), results = [];
    for (const note of notes) results.push(this.save(events.parse(await this.getNote(note.note_id), this.config)));
    return { candidates: results, canonical_summary_changed: false };
  }
  async publish(key, payload, type, state, stateFile) {
    const digest = events.hash(JSON.stringify(payload));
    let doc = state.documents[key];
    if (doc?.digest === digest && doc.verified && doc.linked) return doc;
    if (doc?.digest !== digest) {
      const label = key === 'CURRENT' ? 'CURRENT' : `DOC ${path.posix.basename(key, '.md').replace(/[\r\n]/g, ' ')}`;
      const title = `${this.prefix} · ${label} · ${new Date().toISOString()}`;
      const display = type === 'DOCUMENT_V1' ? payload.content : 'Current memory manifest. Historical snapshots are evidence, not current instructions.';
      const content = `# ${title}\n\n${display}\n\n\`\`\`text\n${events.envelope(type, payload)}\n\`\`\`\n`;
      const imported = await this.api('openapi/note/v1/import_doc', { content_format: 1, content });
      if (!imported.note_id) throw new Error('ima did not return a note ID');
      doc = state.documents[key] = { digest, note_id: imported.note_id, title, verified: false, linked: false };
      writeJson(stateFile, state);
    }
    if (events.hash(JSON.stringify(events.unpack(type, await this.getNote(doc.note_id)))) !== digest) throw new Error('ima readback verification failed');
    doc.verified = true; writeJson(stateFile, state);
    if (!doc.linked) {
      await this.api('openapi/wiki/v1/add_knowledge', { media_type: 11, note_info: { content_id: doc.note_id }, title: doc.title, knowledge_base_id: this.config.knowledge_base_id });
      doc.linked = true; writeJson(stateFile, state);
    }
    return doc;
  }
  async sync({ apply = false } = {}) {
    // Validate every local document before the first network write.
    const snapshot = this.snapshot();
    const contents = Object.fromEntries(Object.keys(snapshot.documents).map(relative => {
      const text = readText(safePath(this.root, relative));
      events.checkSecrets(text);
      if (Buffer.byteLength(text, 'utf8') > 65536) throw new Error('Split documents larger than 64 KiB before cloud sync');
      return [relative, text];
    }));
    if (!apply) return { dry_run: true, destination: 'ima', documents: Object.keys(contents), candidate_documents_included: true, network_requests: 0 };
    const stateKey = events.hash(`${this.config.memory_space_id}:${this.config.knowledge_base_id}`).slice(0, 16);
    const stateFile = safePath(this.root, `state/sync-${stateKey}.json`), lockFile = safePath(this.root, 'state/sync.lock');
    fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
    let fd;
    try {
      try { fd = fs.openSync(lockFile, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid)); }
      catch { throw new Error('Sync is locked; check that no sync process is running before removing a stale lock'); }
      const state = fs.existsSync(stateFile) ? readJson(stateFile) : { documents: {} };
      const manifest = { ...snapshot, knowledge_base_id: this.config.knowledge_base_id, documents: {} };
      for (const [relative, content] of Object.entries(contents)) {
        const doc = await this.publish(relative, { memory_space_id: this.config.memory_space_id, document: relative, content }, 'DOCUMENT_V1', state, stateFile);
        manifest.documents[relative] = { ...snapshot.documents[relative], note_id: doc.note_id };
      }
      await this.publish('CURRENT', manifest, 'MANIFEST_V1', state, stateFile);
      state.last_success_at = new Date().toISOString(); writeJson(stateFile, state);
      return { synced: true, documents: Object.keys(contents).length, manifest_verified: true };
    } finally { if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(lockFile); } }
  }
}
module.exports = { ImaStore, makeApi };
