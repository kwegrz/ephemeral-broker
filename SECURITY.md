SECURITY.md

Threat Model

What we’re protecting:
• API tokens, STS credentials, OAuth refresh tokens.
• Test fixture handles, session IDs.
• Rate-limit counters.

Threats considered:
• Accidental disk persistence.
• Unauthorized access to broker pipe.
• Memory leaks exposing secrets longer than intended.
• Replay or tampering of broker messages.

Out of scope:
• Cross-host secret sharing.
• Long-term secure storage (use Vault/KMS).
• Protecting against a root-level attacker on the host.

⸻

Security Features
• Ephemeral state: broker dies → secrets vanish.
• Random pipe names: generated fresh on every run.
• File permissions: UDS restricted to 0700 (owner-only access) on Unix systems.
• Auth option: HMAC-SHA256 on each request with shared secret, using timing-safe comparison to prevent timing attacks.
• TTL required: keys auto-expire; stale entries cleaned regularly.
• Size caps: max request (1MB), value (256KB), and total item count (10,000).
• Graceful teardown: clears store + unlinks sockets on exit.
• No external dependencies: uses only Node.js core modules to minimize supply chain risks.

⸻

Best Practices
• Always run with --auth in CI or multi-user hosts.
• Keep values small (tokens, JSON blobs). Don’t store binaries.
• Use broker for short-lived secrets only; persist long-term config elsewhere.
• Mount the pipe directory (/tmp or volume) as private in containerized setups.
• Rotate EPHEMERAL_BROKER_SECRET between runs.

⸻

Common Pitfalls
• Orphaned sockets: if process crashes, you may need to remove stale .sock files.
• Windows admin perms: some environments require elevated rights for Named Pipes.
• Multi-host CI: broker only works per host; cross-machine state needs Vault/Redis/etc.

⸻

Future Security Work
• TLS/mTLS transport option (for optional TCP mode).
• Automatic secret rotation hooks.
• Audit logging of broker requests.
• Pluggable auth providers beyond HMAC.
