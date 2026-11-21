'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { safePath, readJson, readText, writeJson } = require('./config.cjs');
const { LocalStore, walk, meta, checkProject, isPublishedDocument } = require('./store.cjs');
const { createTrust } = require('./trust.cjs');
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
  constructor(root, config, api = makeApi(config), access) {
    super(root, config, access);
    if (!config.knowledge_base_id) throw new Error('Set knowledge_base_id to your own ima knowledge base');
    this.api = api;
    this.prefix = `${config.namespace} · ${config.memory_space_id}`;
    this.trust = createTrust(root, config);
    const titleKey = events.hash(JSON.stringify(this.trust.space)).slice(0, 12);
    this.currentPrefix = `amc${titleKey}`;
    this.inboxPrefix = `ami${titleKey}`;
  }
  // IMA search previews truncate titles longer than 30 characters.
  currentTitle(generation) { return `${this.currentPrefix} ${generation.toString(36).padStart(11, '0')}`; }
  candidateTitle(eventId) { return `${this.inboxPrefix} ${events.hash(eventId).slice(0, 10)}`; }
  async legacyNotes(kind, eventId) {
    const title = `${this.prefix} · ${kind} ·${eventId ? ` ${eventId}` : ''}`;
    return this.findNotes(title, this.prefix.slice(0, 24));
  }
  async findNotes(title, visiblePrefix = title) {
    const found = [];
    for (let start = 0; start < 2000; start += 20) {
      const data = await this.api('openapi/note/v1/search_note', { search_type: 0, sort_type: 0, query_info: { title }, start, end: start + 20 });
      if (!Array.isArray(data.search_note_infos)) throw new Error('Unexpected ima search response');
      found.push(...data.search_note_infos.map(x => x.note_book_info).filter(x => x && typeof x.title === 'string' && x.title.startsWith(visiblePrefix)));
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
    if (manifest.schema_version !== 2 || manifest.namespace !== this.config.namespace || manifest.memory_space_id !== this.config.memory_space_id || manifest.knowledge_base_id !== this.config.knowledge_base_id || !manifest.documents || typeof manifest.documents !== 'object' || Array.isArray(manifest.documents)) throw new Error('Manifest does not belong to this memory space and knowledge base');
    const documents = {};
    for (const [relative, doc] of Object.entries(manifest.documents)) {
      safePath(this.root, relative);
      if (!isPublishedDocument(relative, this.config) || !doc || typeof doc.note_id !== 'string' || !doc.note_id || !/^[0-9a-f]{64}$/.test(doc.hash)) throw new Error('Invalid document in cloud manifest');
      documents[relative] = { note_id: doc.note_id, hash: doc.hash, ...meta(relative) };
    }
    return { ...manifest, documents };
  }
  async current(project) {
    const allowed = this.readScope(project);
    const pin = this.trust.exportPin();
    let latest, remoteGeneration;
    let incomplete = false;
    let notes = [];
    try { notes = await this.findNotes(`${this.currentPrefix} `); }
    catch { incomplete = true; }
    notes = notes.map(note => ({ id: note.note_id, title: note.title, generation: Number.parseInt(note.title.slice(this.currentPrefix.length + 1, this.currentPrefix.length + 12), 36) }))
      .filter(note => typeof note.id === 'string' && Number.isSafeInteger(note.generation) && note.title.startsWith(this.currentTitle(note.generation)))
      .sort((a, b) => b.generation - a.generation);
    const seen = new Set();
    for (const note of notes.slice(0, 30)) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      try {
        const signed = events.unpack('MANIFEST_V2', await this.getNote(note.id));
        const manifest = this.validateManifest(this.trust.open(signed, pin));
        if (manifest.generation !== note.generation) throw new Error('CURRENT preview does not match its signed generation');
        latest = signed;
        remoteGeneration = manifest.generation;
        break;
      } catch { incomplete = true; }
    }
    // A signed v0.2.0 note may have an abbreviated title. Authenticate its body and scope.
    if (!latest) {
      try {
        const legacy = (await this.legacyNotes('CURRENT')).sort((a, b) => Number(b.modify_time) - Number(a.modify_time));
        for (const note of legacy.slice(0, 30)) {
          if (typeof note.note_id !== 'string' || seen.has(note.note_id)) continue;
          seen.add(note.note_id);
          const text = await this.getNote(note.note_id);
          if (!text.includes('MEMORY_MANIFEST_V2_BEGIN')) continue;
          try {
            const signed = events.unpack('MANIFEST_V2', text);
            const manifest = this.validateManifest(this.trust.open(signed, pin));
            if (!remoteGeneration || manifest.generation > remoteGeneration) {
              latest = signed;
              remoteGeneration = manifest.generation;
            }
          } catch { incomplete = true; }
        }
      } catch { incomplete = true; }
    }
    const accepted = latest ? this.trust.remember(latest) : this.trust.lastGood();
    if (!accepted) throw new Error('No trusted CURRENT manifest could be read; check IMA access and the publisher pin');
    const result = this.validateManifest(this.trust.open(accepted, pin));
    result.stale = incomplete || result.generation !== remoteGeneration;
    result.documents = Object.fromEntries(Object.entries(result.documents).filter(([, d]) => allowed(d)));
    return result;
  }
  async read(document, manifest) {
    if (typeof document !== 'string' || !isPublishedDocument(document, this.config) || !this.readScope()(meta(document))) throw new Error('Document is not in the current manifest');
    const index = manifest || await this.current();
    if (!Object.hasOwn(index.documents, document)) throw new Error('Document is not in the current manifest');
    const doc = index.documents[document];
    const payload = events.unpack('DOCUMENT_V1', await this.getNote(doc.note_id));
    if (payload.document !== document || payload.memory_space_id !== this.config.memory_space_id || typeof payload.content !== 'string' || events.hash(payload.content) !== doc.hash) throw new Error('Cloud document revision mismatch');
    if (!manifest && index.stale) return `Verified cached CURRENT generation ${index.generation}. Latest publication could not be confirmed.\n\n${payload.content}`;
    return payload.content;
  }
  async search(args) {
    const { query, project, agent, include_candidates = false, offset = 0 } = args;
    checkProject(this.config, project);
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || !Number.isInteger(offset) || offset < 0 || (agent !== undefined && !require('./config.cjs').validSlug(agent)) || typeof include_candidates !== 'boolean') throw new Error('Invalid search arguments');
    const manifest = await this.current(project);
    const allowed = Object.entries(manifest.documents).filter(([, d]) => !agent || agent === d.agent);
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
    if (include_candidates) {
      const local = new LocalStore(this.root, { ...this.config, projects: this.projects });
      const matches = await local.search({ query, project, agent, include_candidates: true, offset });
      results.push(...matches.results.filter(d => d.category === 'candidate'));
    }
    return { project, results, next_offset: isEnd ? null : cursor, candidates_included: include_candidates, scope: include_candidates ? 'current_manifest_and_local_candidates' : 'current_manifest_only', stale: manifest.stale, generation: manifest.generation };
  }
  async record(input) {
    const event = this.submission(input);
    if (input.request_id === undefined) return this.sendCandidate(event, {});
    if (typeof input.request_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.request_id)) throw new Error('Invalid request_id');
    const { event_id, submitted_at, ...candidate } = event;
    const digest = events.hash(JSON.stringify(candidate));
    const requestKey = events.hash(JSON.stringify([this.trust.space, event.agent, input.request_id]));
    const receiptFile = safePath(this.root, `state/submissions/${requestKey}.json`);
    const lockFile = safePath(this.root, `state/submissions/${requestKey}.lock`);
    fs.mkdirSync(path.dirname(receiptFile), { recursive: true, mode: 0o700 });
    let fd;
    try {
      try { fd = fs.openSync(lockFile, 'wx', 0o600); }
      catch (error) { if (error.code !== 'EEXIST') throw error; throw new Error('This submission is already in progress'); }
      let receipt;
      if (fs.existsSync(receiptFile)) {
        receipt = readJson(receiptFile);
        if (receipt.digest !== digest) throw new Error('Request ID already exists with different content');
      } else {
        receipt = { digest, event_id, submitted_at };
        writeJson(receiptFile, receipt);
      }
      const stableEvent = events.normalize(event, this.config, { id: receipt.event_id, stamp: receipt.submitted_at });
      return await this.sendCandidate(stableEvent, receipt, receiptFile);
    } finally { if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(lockFile); } }
  }
  async sendCandidate(event, receipt, receiptFile) {
    const title = this.candidateTitle(event.event_id);
    const content = `# ${title}\n\n\`\`\`text\n${events.envelope('INBOX_SCOPE_V1', this.trust.space)}\n\`\`\`\n\n${events.format(event)}`;
    if (!receipt.linked) {
      if (!receipt.note_id) {
        const prior = receipt.attempted ? await this.findCandidate(event.event_id) : null;
        if (receiptFile && !receipt.attempted) {
          receipt.attempted = true;
          writeJson(receiptFile, receipt);
        }
        const result = prior || await this.api('openapi/note/v1/import_doc', { content_format: 1, content });
        if (!result.note_id) throw new Error('ima did not return a note ID');
        receipt.note_id = result.note_id;
        if (receiptFile) writeJson(receiptFile, receipt);
      }
      const saved = this.parseCandidate(await this.getNote(receipt.note_id));
      if (JSON.stringify(event) !== JSON.stringify(saved.event)) throw new Error('Candidate readback verification failed');
      await this.api('openapi/wiki/v1/add_knowledge', { media_type: 11, note_info: { content_id: receipt.note_id }, title: saved.title, knowledge_base_id: this.config.knowledge_base_id });
      if (receiptFile) writeJson(receiptFile, { ...receipt, linked: true });
    }
    return { accepted_as_candidate: true, event_id: event.event_id, identity_verified: false, canonical_summary_changed: false };
  }
  parseCandidate(content) {
    const event = events.parse(content, this.config);
    const legacyTitle = `${this.prefix} · INBOX · ${event.event_id}`;
    if (content.replace(/^#\s*/, '').startsWith(legacyTitle)) return { event, title: legacyTitle };
    const scoped = events.unpack('INBOX_SCOPE_V1', content);
    if (!Object.entries(this.trust.space).every(([key, value]) => scoped?.[key] === value)) throw new Error('Candidate belongs to another memory space');
    return { event, title: this.candidateTitle(event.event_id) };
  }
  async findCandidate(eventId) {
    const title = this.candidateTitle(eventId);
    const notes = await this.findNotes(title);
    for (const note of notes) {
      if (!note.title.startsWith(title) || typeof note.note_id !== 'string') continue;
      const content = await this.getNote(note.note_id);
      try { if (this.parseCandidate(content).event.event_id === eventId) return note; } catch { /* Continue past malformed results. */ }
    }
    for (const note of await this.legacyNotes('INBOX', eventId)) {
      if (typeof note.note_id !== 'string') continue;
      const content = await this.getNote(note.note_id);
      if (!content.startsWith(`${this.prefix} · INBOX · ${eventId}`) && !content.startsWith(`# ${this.prefix} · INBOX · ${eventId}`)) continue;
      try { if (this.parseCandidate(content).event.event_id === eventId) return note; } catch { /* Continue past malformed results. */ }
    }
    return null;
  }
  async pullInbox() {
    const current = await this.findNotes(`${this.inboxPrefix} `), legacy = await this.legacyNotes('INBOX');
    const results = [], quarantined = [], seen = new Set();
    for (const note of [...current, ...legacy]) {
      if (typeof note.note_id !== 'string' || seen.has(note.note_id)) continue;
      seen.add(note.note_id);
      const content = await this.getNote(note.note_id);
      const isShort = note.title.startsWith(`${this.inboxPrefix} `);
      if (!isShort && !content.replace(/^#\s*/, '').startsWith(`${this.prefix} · INBOX · `)) continue;
      let event;
      try {
        const candidate = this.parseCandidate(content);
        if (isShort && !note.title.startsWith(candidate.title)) throw new Error('Inbox preview does not match its event');
        event = candidate.event;
      } catch {
        quarantined.push({ note_id: note.note_id, reason: 'invalid_candidate' });
        continue;
      }
      try { results.push(this.save(event)); }
      catch (error) {
        if (error.code !== 'EVENT_CONFLICT') throw error;
        quarantined.push({ note_id: note.note_id, reason: 'event_conflict' });
      }
    }
    writeJson(safePath(this.root, 'state/inbox-quarantine.json'), quarantined);
    return { candidates: results, quarantined, canonical_summary_changed: false };
  }
  async publish(key, payload, type, state, stateFile) {
    const digest = events.hash(JSON.stringify(payload));
    let doc = state.documents[key];
    if (doc?.digest === digest && doc.verified && doc.linked) return doc;
    if (doc?.digest !== digest) {
      const label = `DOC ${path.posix.basename(key, '.md').replace(/[\r\n]/g, ' ')}`;
      const title = key === 'CURRENT' ? this.currentTitle(payload.manifest.generation) : `${this.prefix} · ${label} · ${new Date().toISOString()}`;
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
    // Capture one version of each approved document, then build its manifest from the same bytes.
    const files = walk(this.root).filter(p => isPublishedDocument(p, this.config));
    const contents = Object.fromEntries(files.map(relative => {
      const text = readText(safePath(this.root, relative));
      events.checkSecrets(text);
      if (Buffer.byteLength(text, 'utf8') > 65536) throw new Error('Split documents larger than 64 KiB before cloud sync');
      return [relative, text];
    }));
    if (!apply) return { dry_run: true, destination: 'ima', documents: files, candidate_documents_included: false, network_requests: 0 };
    const stateKey = events.hash(`${this.config.memory_space_id}:${this.config.knowledge_base_id}`).slice(0, 16);
    const stateFile = safePath(this.root, `state/sync-${stateKey}.json`), lockFile = safePath(this.root, 'state/sync.lock');
    fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
    let fd;
    try {
      try { fd = fs.openSync(lockFile, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid)); }
      catch { throw new Error('Sync is locked; check that no sync process is running before removing a stale lock'); }
      const state = fs.existsSync(stateFile) ? readJson(stateFile) : { documents: {} };
      const key = this.trust.signingKey();
      const manifest = { schema_version: 2, ...this.trust.space, generation: 0, documents: {} };
      for (const [relative, content] of Object.entries(contents)) {
        const doc = await this.publish(relative, { memory_space_id: this.config.memory_space_id, document: relative, content }, 'DOCUMENT_V1', state, stateFile);
        manifest.documents[relative] = { hash: events.hash(content), note_id: doc.note_id };
      }
      const revision = events.hash(JSON.stringify(manifest));
      const observed = this.trust.lastGood();
      const watermark = observed ? this.trust.open(observed).generation : 0;
      if (state.pending_manifest?.title_format !== 2 || state.pending_manifest.revision !== revision || state.pending_manifest.signed.manifest.generation < watermark) {
        manifest.generation = Math.max(Date.now(), (state.pending_manifest?.signed.manifest.generation || 0) + 1, watermark + 1);
        state.pending_manifest = { revision, title_format: 2, signed: this.trust.seal(manifest, key) };
        writeJson(stateFile, state);
      }
      const signed = state.pending_manifest.signed;
      this.trust.open(signed);
      await this.publish('CURRENT', signed, 'MANIFEST_V2', state, stateFile);
      this.trust.remember(signed);
      state.last_success_at = new Date().toISOString(); writeJson(stateFile, state);
      return { synced: true, documents: files.length, manifest_verified: true, generation: signed.manifest.generation };
    } finally { if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(lockFile); } }
  }
}
module.exports = { ImaStore, makeApi };
