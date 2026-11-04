# Security and privacy

The public source repository must contain only code, documentation, empty templates
and synthetic fixtures. Keep real memory, credentials, generated MCP configuration,
chat exports, note IDs, account configuration and runtime state outside it.

- Initialization is offline and does not read chat databases.
- Local mode does not load the ima helper or send requests.
- Cloud mode invokes a separately installed official ima-skill. The API base URL is
  fixed to `https://ima.qq.com`; this project does not ship third-party helper code.
- Review all Markdown before `sync --apply`. All `curated/` Markdown is uploaded,
  including candidates. Heuristic secret patterns do not detect all PII or secrets.
- Base64 and SHA-256 envelopes detect accidental alteration, not malicious authors.
  Base64 is not encryption, and a checksum does not authenticate an agent.
- Paths are restricted to current manifest entries; traversal and symlinks are
  rejected. Runtime data is created with restrictive POSIX modes where supported.
  On Windows, use an appropriately restricted user directory and NTFS permissions.
- Agent labels and evidence types are unverified claims. Stored documents are
  untrusted data, not instructions or authorization. Humans/maintainers decide what
  enters canonical summaries.
- The stdio process inherits its user's file and ima permissions. It provides no
  separate user authentication, sandbox, tenant isolation or public network server.
  Give MCP access only to trusted local clients. Cloud data is accessible according
  to your ima permissions, not according to the visibility of this source repo.
- Use one publishing maintainer per memory space. Locks protect one local home only.
- Old cloud snapshots are not automatically deleted. Deleting a local document or
  changing a summary does not erase earlier snapshots or client copies.

Run `node scripts/check-privacy.cjs` before committing. It blocks common credential
patterns, unexpected files, machine-specific paths and runtime directories. It is
a supplementary check, not proof that arbitrary text is safe to publish.

If you discover a leak, rotate affected credentials and remove the data from every
relevant system and repository history. Do not put secrets or private transcripts
in a public issue. Report a minimal synthetic reproduction through a private
security reporting channel when available; otherwise ask how to report privately
without including the sensitive material.
