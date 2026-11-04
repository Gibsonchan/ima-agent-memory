#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseArgs } = require('node:util');
const config = require('../lib/config.cjs');
function doctor(override) {
  const root = config.home(override), initialized = fs.existsSync(path.join(root, 'config.json'));
  const result = { node_supported: Number(process.versions.node.split('.')[0]) >= 22, memory_initialized: initialized, config_valid: false, backend: null, ima_helper_detected: false, ima_credentials_detected: false, network_requests: 0, files_written: 0 };
  if (!initialized) return result;
  let settings;
  try { settings = config.load(root); result.config_valid = true; result.backend = settings.backend; }
  catch { result.configuration_error = 'Existing config is not compatible; preserve it and choose a separate memory home or review it manually'; return result; }
  const dir = process.env.IMA_SKILL_DIR || settings.ima_skill_dir;
  result.ima_helper_detected = !!(dir && path.isAbsolute(dir) && fs.existsSync(path.join(dir, 'ima_api.cjs')));
  const hasClient = !!(process.env.IMA_OPENAPI_CLIENTID || process.env.IMA_CLIENT_ID || fs.existsSync(path.join(os.homedir(), '.config', 'ima', 'client_id')));
  const hasKey = !!(process.env.IMA_OPENAPI_APIKEY || process.env.IMA_API_KEY || fs.existsSync(path.join(os.homedir(), '.config', 'ima', 'api_key')));
  result.ima_credentials_detected = hasClient && hasKey;
  // Presence is not authentication. No credential values or personal paths are returned.
  return result;
}
if (require.main === module) {
  try { const { values } = parseArgs({ options: { home: { type: 'string' } } }); const result = doctor(values.home); console.log(JSON.stringify(result, null, 2)); if (!result.node_supported || (result.memory_initialized && !result.config_valid)) process.exitCode = 1; }
  catch { console.error('Environment check failed; no changes were made'); process.exitCode = 1; }
}
module.exports = { doctor };
