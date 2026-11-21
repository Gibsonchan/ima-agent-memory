'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { safePath, readText, readJson, writeJson } = require('./config.cjs');
const events = require('./events.cjs');

function walk(root, relative = 'curated') {
  const folder = safePath(root, relative);
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(item => {
    if (item.isSymbolicLink()) throw new Error('Symbolic links are not allowed in memory data');
    const child = `${relative}/${item.name}`;
    return item.isDirectory() ? walk(root, child) : item.isFile() && item.name.endsWith('.md') ? [child] : [];
  });
}
function meta(relative) {
  const p = relative.split('/');
  if (p[1] === 'submissions') return { project: p[2], agent: p[3], category: 'candidate' };
  if (p[1] === 'projects') return { project: p[2].replace(/\.md$/, ''), agent: null, category: 'current_summary' };
  if (p[1] === 'decisions') return { project: p[2], agent: null, category: 'decisions' };
  return { project: 'global', agent: null, category: 'guidance' };
}
function checkProject(config, project, optional = false) {
  if (project === 'all' || (optional && project === undefined)) return;
  if (!config.projects.some(p => p.id === project)) throw new Error('Unknown project; use all explicitly for cross-project access');
}
function isPublishedDocument(relative, config) {
  if (['curated/00-entry.md', 'curated/01-preferences.md'].includes(relative)) return true;
  const parts = relative.split('/');
  if (parts[0] !== 'curated') return false;
  const file = parts.at(-1);
  if (!file?.endsWith('.md')) return false;
  if (parts[1] === 'projects' && parts.length === 3) return config.projects.some(p => p.id === file.slice(0, -3));
  if (parts[1] === 'decisions' && parts.length >= 4) return config.projects.some(p => p.id === parts[2]);
  return false;
}
class LocalStore {
  constructor(root, config, { project, agent } = {}) {
    checkProject(config, project, true);
    if (agent !== undefined && !require('./config.cjs').validSlug(agent)) throw new Error('Invalid bound agent');
    this.root = root;
    this.config = config;
    this.boundProject = project;
    this.boundAgent = agent;
  }
  get projects() { return this.config.projects.filter(p => !this.boundProject || this.boundProject === 'all' || p.id === this.boundProject); }
  readScope(project) {
    if (project && project !== 'all' && !this.projects.some(p => p.id === project)) throw new Error('Unknown project; use all explicitly for cross-project access');
    return d => d.project === 'global' || this.projects.some(p => p.id === d.project) && (!project || project === 'all' || d.project === project);
  }
  snapshot() {
    return { schema_version: 1, memory_space_id: this.config.memory_space_id, documents: Object.fromEntries(walk(this.root).filter(p => isPublishedDocument(p, this.config)).map(relative => [relative, { hash: events.hash(readText(safePath(this.root, relative))), ...meta(relative) }])) };
  }
  async current(project) {
    const result = this.snapshot();
    const allowed = this.readScope(project);
    result.documents = Object.fromEntries(Object.entries(result.documents).filter(([, d]) => allowed(d)));
    return result;
  }
  async read(document) {
    if (typeof document !== 'string' || !isPublishedDocument(document, this.config) || !this.readScope()(meta(document))) throw new Error('Document is not in the current manifest');
    const file = safePath(this.root, document);
    if (!fs.existsSync(file)) throw new Error('Document is not in the current manifest');
    return readText(file);
  }
  async search({ query, project, agent, include_candidates = false, offset = 0 }) {
    checkProject(this.config, project);
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || !Number.isInteger(offset) || offset < 0 || (agent !== undefined && !require('./config.cjs').validSlug(agent)) || typeof include_candidates !== 'boolean') throw new Error('Invalid search arguments');
    const allowed = this.readScope(project);
    const documents = { ...(await this.current(project)).documents };
    if (include_candidates) for (const document of this.candidatePaths()) {
      documents[document] = meta(document);
    }
    const results = [];
    for (const [document, d] of Object.entries(documents)) {
      if (!allowed(d) || (agent && agent !== d.agent)) continue;
      const content = d.category === 'candidate' ? readText(safePath(this.root, document)) : await this.read(document);
      const i = content.toLowerCase().indexOf(query.toLowerCase());
      if (i >= 0) results.push({ document, ...d, excerpt: content.slice(Math.max(0, i - 120), i + 700) });
    }
    return { project, results: results.slice(offset, offset + 8), next_offset: offset + 8 < results.length ? offset + 8 : null, candidates_included: include_candidates, scope: 'current_manifest_only' };
  }
  save(event) {
    event = events.normalize(event, this.config, { id: event.event_id, stamp: event.submitted_at });
    const relative = `curated/submissions/${event.project}/${event.agent}/${event.event_id}.md`;
    const file = safePath(this.root, relative), content = events.format(event);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (readText(file) !== content) throw Object.assign(new Error('Event ID already exists with different content'), { code: 'EVENT_CONFLICT' });
    }
    return { accepted_as_candidate: true, event_id: event.event_id, document: relative, identity_verified: false };
  }
  submission(input) {
    if (this.boundAgent && input?.agent && input.agent !== this.boundAgent) throw new Error('Agent differs from this client’s configured identity');
    if (!this.projects.some(p => p.id === input?.project)) throw new Error('Unknown project');
    return events.normalize({ ...input, agent: this.boundAgent || input?.agent }, this.config);
  }
  async record(input) { return this.save(this.submission(input)); }
  candidatePaths() { return walk(this.root, 'curated/submissions').filter(p => meta(p).category === 'candidate'); }
  queue() {
    const reviewFile = safePath(this.root, 'state/reviews.json');
    const reviews = fs.existsSync(reviewFile) ? readJson(reviewFile) : {};
    const groups = new Map();
    for (const file of this.candidatePaths()) {
      const event = events.parse(readText(safePath(this.root, file)), this.config), key = `${event.project}/${event.subject}`;
      if (!groups.has(key)) groups.set(key, { project: event.project, subject: event.subject, candidates: [] });
      groups.get(key).candidates.push({ ...event, review: reviews[event.event_id] || null });
    }
    return [...groups.values()];
  }
  review(id, { status, note, source }) {
    if (!['accepted', 'rejected', 'conflict', 'superseded'].includes(status) || typeof note !== 'string' || !note.trim() || typeof source !== 'string' || !source.trim()) throw new Error('Review requires status, note and source');
    if (!this.queue().some(g => g.candidates.some(e => e.event_id === id))) throw new Error('Unknown event ID');
    events.checkSecrets(JSON.stringify({ note, source }));
    const file = safePath(this.root, 'state/reviews.json');
    const lock = safePath(this.root, 'state/reviews.lock');
    fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
    let fd;
    try {
      fd = fs.openSync(lock, 'wx', 0o600);
      const reviews = fs.existsSync(file) ? readJson(file) : {};
      reviews[id] = { status, note, source, reviewed_at: new Date().toISOString() };
      writeJson(file, reviews);
      return { event_id: id, review: reviews[id], canonical_summary_changed: false };
    } finally { if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(lock); } }
  }
}
module.exports = { LocalStore, walk, meta, checkProject, isPublishedDocument };
