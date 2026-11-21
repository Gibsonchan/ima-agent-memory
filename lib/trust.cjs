'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { safePath, readJson, writeJson } = require('./config.cjs');
const { hash } = require('./events.cjs');

function scope(config) {
  return { namespace: config.namespace, memory_space_id: config.memory_space_id, knowledge_base_id: config.knowledge_base_id };
}

function createTrust(root, config) {
  const space = scope(config), target = hash(JSON.stringify(space)).slice(0, 32);
  const folder = `state/trust-${target}`;
  const pinFile = safePath(root, `${folder}/publisher.json`);
  const keyFile = safePath(root, `${folder}/signing.json`);
  const sameScope = value => Object.entries(space).every(([k, v]) => value?.[k] === v);

  function publicKey(pin) {
    if (!sameScope(pin) || typeof pin.public_key !== 'string') throw new Error('Publisher pin does not belong to this memory space');
    const der = Buffer.from(pin.public_key, 'base64');
    if (der.toString('base64') !== pin.public_key || der.length !== 44) throw new Error('Invalid publisher public key');
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Invalid publisher public key');
    return key;
  }

  function pinPublisher(pin) {
    publicKey(pin);
    if (fs.existsSync(pinFile)) {
      if (readJson(pinFile).public_key !== pin.public_key) throw new Error('A different publisher is already pinned');
      return;
    }
    fs.mkdirSync(path.dirname(pinFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(pinFile, JSON.stringify({ ...space, public_key: pin.public_key }) + '\n', { mode: 0o600, flag: 'wx' });
  }

  function exportPin() {
    if (!fs.existsSync(pinFile)) throw new Error('No CURRENT publisher pin; import it from the maintainer before reading or publish on the maintainer machine');
    const pin = readJson(pinFile);
    publicKey(pin);
    return { ...space, public_key: pin.public_key };
  }

  function signingKey() {
    if (!fs.existsSync(keyFile)) {
      if (fs.existsSync(pinFile)) throw new Error('Only the maintainer with the pinned signing key may publish');
      const pair = crypto.generateKeyPairSync('ed25519');
      writeJson(keyFile, { private_key: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') });
    }
    if (process.platform !== 'win32' && (fs.statSync(keyFile).mode & 0o077)) throw new Error('Restrict the signing key file to the owner before publishing');
    const key = crypto.createPrivateKey({ key: Buffer.from(readJson(keyFile).private_key, 'base64'), format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Invalid publisher signing key');
    pinPublisher({ ...space, public_key: crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64') });
    return key;
  }

  function seal(manifest, key) {
    const signature = crypto.sign(null, Buffer.from(JSON.stringify(manifest)), key).toString('base64');
    return { manifest, signature };
  }

  function open(signed, pin = exportPin()) {
    const { manifest, signature } = signed || {};
    if (!sameScope(manifest) || typeof signature !== 'string' || signature.length !== 88) throw new Error('Invalid CURRENT signature or scope');
    if (!crypto.verify(null, Buffer.from(JSON.stringify(manifest)), publicKey(pin), Buffer.from(signature, 'base64'))) throw new Error('Invalid CURRENT signature');
    if (manifest.schema_version !== 2 || !Number.isSafeInteger(manifest.generation) || manifest.generation < 1) throw new Error('Invalid CURRENT generation');
    return manifest;
  }

  function lastGood() {
    const directory = safePath(root, folder);
    if (!fs.existsSync(directory)) return null;
    // Generations are immutable entries so an older concurrent reader cannot overwrite a newer one.
    const last = fs.readdirSync(directory).filter(n => /^verified-[0-9]{16}\.json$/.test(n)).sort().at(-1);
    return last ? readJson(safePath(root, `${folder}/${last}`)) : null;
  }

  function remember(signed) {
    const manifest = open(signed), previous = lastGood();
    if (previous) {
      const accepted = open(previous);
      if (accepted.generation > manifest.generation) return previous;
      if (accepted.generation === manifest.generation) {
        if (hash(JSON.stringify(accepted)) !== hash(JSON.stringify(manifest))) throw new Error('Conflicting CURRENT manifests share a generation');
        return previous;
      }
    }
    const file = `verified-${String(manifest.generation).padStart(16, '0')}.json`;
    writeJson(safePath(root, `${folder}/${file}`), signed);
    return lastGood();
  }

  return { space, signingKey, seal, open, lastGood, remember, pinPublisher, exportPin };
}

module.exports = { createTrust };
