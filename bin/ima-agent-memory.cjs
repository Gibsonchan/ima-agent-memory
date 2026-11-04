#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { parseArgs } = require('node:util');
const config = require('../lib/config.cjs');
const { LocalStore } = require('../lib/store.cjs');
const { ImaStore } = require('../lib/ima.cjs');
const HELP = `ima-agent-memory 0.1.0 (Node >=22)

init [--project demo] [--name "Demo project"]  Create an empty LOCAL memory home
current [--project ID|all]                    Show the current manifest
read DOCUMENT                                Read a current document
search QUERY --project ID|all                 Search maintained memory
record --file EVENT.json                      Submit a sourced candidate
queue                                        Group local candidates by project/subject
review EVENT_ID --status STATUS --note TEXT --source TEXT
                                             Save a local review; summaries stay manual
sync [--apply]                                Preview or publish local documents to ima
pull-inbox                                    Download this memory space's ima candidates
mcp-config                                   Print a generic MCP client configuration
serve                                        Run MCP over stdio (2025-11-25 and earlier)

Global: --home DIRECTORY (or IMA_MEMORY_HOME). Data defaults outside the code repo.
Search: --include-candidates, --agent SLUG, --offset NUMBER.
ima requires your own knowledge_base_id and the official ima-skill. See README.
`;
async function main() {
  const { values: a, positionals: p } = parseArgs({ allowPositionals: true, strict: true, options: {
    home: { type: 'string' }, project: { type: 'string' }, name: { type: 'string' }, file: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' }, source: { type: 'string' }, agent: { type: 'string' }, offset: { type: 'string' }, apply: { type: 'boolean' }, 'include-candidates': { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
  } });
  const command = p[0], root = config.home(a.home);
  if (a.help || !command || command === 'help') return console.log(HELP);
  if (command === 'init') return console.log(JSON.stringify(config.init(root, { project: a.project, name: a.name }), null, 2));
  if (command === 'mcp-config') return console.log(JSON.stringify({ mcpServers: { agent_memory: { command: process.execPath, args: [require('node:path').resolve(__filename), 'serve'], env: { IMA_MEMORY_HOME: root } } } }, null, 2));
  if (!fs.existsSync(require('node:path').join(root, 'config.json'))) throw new Error('Memory home not initialized; run init first');
  const settings = config.load(root), local = new LocalStore(root, settings);
  const store = settings.backend === 'ima' ? new ImaStore(root, settings) : local;
  let result;
  if (command === 'serve') return require('../lib/mcp.cjs').serve(store, settings);
  if (command === 'current') result = await store.current(a.project);
  else if (command === 'read') result = await store.read(p[1]);
  else if (command === 'search') result = await store.search({ query: p.slice(1).join(' '), project: a.project, agent: a.agent, include_candidates: !!a['include-candidates'], offset: a.offset === undefined ? 0 : Number(a.offset) });
  else if (command === 'record') { if (!a.file) throw new Error('record requires --file'); result = await store.record(config.readJson(a.file)); }
  else if (command === 'queue') result = local.queue();
  else if (command === 'review') result = local.review(p[1], { status: a.status, note: a.note, source: a.source });
  else if (command === 'sync') result = await new ImaStore(root, settings).sync({ apply: !!a.apply });
  else if (command === 'pull-inbox') result = await new ImaStore(root, settings).pullInbox();
  else throw new Error('Unknown command; use --help');
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ success: false, message: error.message })); process.exitCode = 1; });
