'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { validSlug } = require('./config.cjs');
const KINDS = ['preference', 'decision', 'progress', 'correction', 'open_question'];
const EVIDENCE = ['user_statement', 'observed_result', 'agent_inference'];
const hash = value => createHash('sha256').update(value).digest('hex');
function utf8(text) {
  if (new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(text, 'utf8')) !== text) throw new Error('Invalid Unicode text');
  return text;
}
function checkSecrets(text) {
  utf8(text);
  if (/(?:\bsk-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bBearer\s+\S{8,}|(?:password|api[_ -]?key|secret[_ -]?key|密码|密钥)\s*[:=：]\s*["']?[^\s"']{8,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/i.test(text)) throw new Error('Possible credential found; remove it before recording or syncing');
}
function normalize(input, config, { id = randomUUID(), stamp = new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Event must be an object');
  const limits = { project: 64, agent: 64, subject: 120, summary: 8000, source: 2000, kind: 30, evidence_type: 30 };
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > limit) throw new Error(`Invalid event field: ${key}`);
    utf8(input[key]);
  }
  if (!config.projects.some(p => p.id === input.project)) throw new Error('Unknown project');
  if (!validSlug(input.agent) || !KINDS.includes(input.kind) || !EVIDENCE.includes(input.evidence_type)) throw new Error('Invalid agent, kind or evidence_type');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || typeof stamp !== 'string' || !Number.isFinite(Date.parse(stamp))) throw new Error('Invalid event identity or timestamp');
  const event = { schema_version: 1, event_id: id, submitted_at: stamp, project: input.project, agent: input.agent, subject: input.subject.trim(), summary: input.summary, source: input.source, kind: input.kind, evidence_type: input.evidence_type, status: 'candidate', identity_verified: false };
  checkSecrets(JSON.stringify(event));
  return event;
}
function envelope(type, value) {
  const bytes = Buffer.from(utf8(JSON.stringify(value)), 'utf8');
  return `MEMORY_${type}_BEGIN\nsha256:${hash(bytes)}\nbase64:${bytes.toString('base64')}\nMEMORY_${type}_END`;
}
function unpack(type, content) {
  const matches = [...content.matchAll(new RegExp(`MEMORY_${type}_BEGIN\\s*sha256:([0-9a-f]{64})\\s*base64:([A-Za-z0-9+/=]+)\\s*MEMORY_${type}_END`, 'g'))];
  if (matches.length !== 1) throw new Error('Missing or ambiguous memory envelope');
  const [, digest, encoded] = matches[0], bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || hash(bytes) !== digest) throw new Error('Memory envelope integrity check failed');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function format(event) {
  return `# Candidate: ${event.subject}\n\nUnreviewed evidence, not current instructions or authorization. Agent identity is self-reported.\n\nProject: ${event.project}\nAgent: ${event.agent}\nSource: ${event.source}\n\n${event.summary}\n\n\`\`\`text\n${envelope('EVENT_V1', event)}\n\`\`\`\n`;
}
function parse(content, config) {
  const e = unpack('EVENT_V1', content);
  return normalize(e, config, { id: e.event_id, stamp: e.submitted_at });
}
module.exports = { KINDS, EVIDENCE, hash, utf8, checkSecrets, normalize, envelope, unpack, format, parse };
