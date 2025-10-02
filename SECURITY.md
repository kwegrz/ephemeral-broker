# Security Policy

## Threat Model

Ephemeral-broker is designed for **same-host, ephemeral state sharing** in development and testing environments. The threat model focuses on protecting secrets from disk persistence and unauthorized access within a single machine.

### What We're Protecting

- API tokens, STS credentials, OAuth refresh tokens
- Test fixture handles, session IDs
- Rate-limit counters, worker coordination state
- Small configuration payloads

### Threats Considered (In Scope)

**1. Accidental Disk Persistence**

- **Threat**: Secrets written to `.env` files, temp files, or cache
- **Mitigation**: All data stored in memory only, never written to disk
- **Result**: No forensic recovery of secrets after process exits

**2. Unauthorized Local Access**

- **Threat**: Other users on the same machine accessing broker data
- **Mitigation**: Unix domain sockets with `0700` permissions (owner-only)
- **Result**: Only the user who started the broker can connect

**3. Process Hijacking / Message Tampering**

- **Threat**: Malicious process impersonating the broker or client
- **Mitigation**: Optional HMAC-SHA256 authentication on every request with timing-safe comparison
- **Result**: Only clients with the correct secret can communicate

**4. Memory Exhaustion (DoS)**

- **Threat**: Malicious client fills broker memory, causing crash
- **Mitigation**: Configurable limits on items, request size, and value size
- **Result**: Broker rejects oversized requests before memory allocation

**5. Stale Data Leakage**

- **Threat**: Secrets persist indefinitely, increasing exposure window
- **Mitigation**: TTL required by default, automatic sweeper every 30s
- **Result**: Data expires automatically, even if client crashes

**6. Race Conditions / Collisions**

- **Threat**: Parallel workers access same resource, causing corruption
- **Mitigation**: Atomic lease/release operations with TTL
- **Result**: Only one worker holds a lease at a time

### Out of Scope

**We do NOT protect against:**

1. **Root-Level Attackers** - If an attacker has root/admin access, they can read process memory
   - **Recommendation**: Use OS-level security (SELinux, AppArmor, Windows Defender)

2. **Multi-Host Security** - Ephemeral-broker is single-host only (no network exposure)
   - **Recommendation**: For multi-host secrets, use HashiCorp Vault or AWS Secrets Manager

3. **Long-Term Persistence** - Data is ephemeral by design (lost on process exit)
   - **Recommendation**: For persistent secrets, use encrypted databases or KMS

4. **Side-Channel Attacks** - No protection against timing attacks, Spectre/Meltdown, etc.
   - **Recommendation**: Run in trusted environments (not shared hosting)

5. **Supply Chain Attacks** - Dependencies could be compromised (though we use zero external deps)
   - **Recommendation**: Use `npm audit`, lock files, and checksum verification

## Security Features

### 1. Ephemeral State

**Broker dies → secrets vanish.**

All data exists only in process memory. On broker exit:

1. Store cleared (`Map.clear()`)
2. Socket file unlinked (Unix)
3. No persistence to disk

**What this means**: Even if the broker crashes, secrets cannot be recovered from disk.

### 2. Random Pipe Names

Generated fresh on every run:

- Unix: `/tmp/broker-{random}.sock`
- Windows: `\\.\pipe\broker-{random}`

**What this prevents**: Predictable pipe names that could be targeted by attackers.

### 3. File Permissions (Unix)

Unix domain sockets restricted to `0700` (owner-only access):

```bash
ls -l /tmp/broker-*.sock
# srwx------ 1 user group 0 Jan 1 12:00 /tmp/broker-abc123.sock
```

**What this means**:

- Only the user who started the broker can connect
- Other users (even in same group) cannot read/write
- Root can still access (see "Out of Scope")

**Windows**: Named pipes use default ACLs (current user + SYSTEM). Run broker and clients in same elevation context for best security.

### 4. HMAC Authentication (Optional)

When enabled, every request must include a valid HMAC signature.

**Setup:**

```javascript
const secret = process.env.EPHEMERAL_SECRET || crypto.randomBytes(32).toString('hex')
const broker = new Broker({ secret })
const client = new Client(pipe, { secret })
```

**How it works:**

- Client computes `HMAC-SHA256(secret, request)` and sends with each request
- Broker verifies signature using timing-safe comparison
- Invalid signatures return `auth_failed` error

**When to use:**

- ✅ **Always** in CI/CD environments
- ✅ Multi-user development machines
- ❌ Single-user local development (can be disabled for convenience)

### 5. Required TTL

Keys auto-expire; stale entries cleaned regularly.

**Enforcement:**

```javascript
// Default: requireTTL = true
const broker = new Broker() // TTL required

await client.set('key', 'value') // Error: TTL required
await client.set('key', 'value', 60000) // ✅ 60 second TTL
```

**Why required:**

- Prevents indefinite memory growth
- Limits exposure window for secrets
- Forces developers to think about data lifetime

**Sweeper**: Runs every 30 seconds (configurable) to remove expired items.

### 6. Size Limits

Max request (1MB), value (256KB), and total item count (10,000).

**Default limits:**

```javascript
const broker = new Broker({
  maxRequestSize: 1 * 1024 * 1024, // 1 MB per request
  maxValueSize: 256 * 1024, // 256 KB per value
  maxItems: 10000 // 10,000 total items
})
```

**What happens:**

- Requests exceeding `maxRequestSize` return `too_large` error
- Values exceeding `maxValueSize` return `too_large` error
- Setting items beyond `maxItems` returns `max_items` error

### 7. Graceful Teardown

Clears store + unlinks sockets on exit.

**On normal exit:**

```javascript
broker.stop()
// 1. Clears store (Map.clear())
// 2. Closes server
// 3. Unlinks socket file (Unix)
```

**On crash:**

- Unix: Stale socket detected and removed on next start
- Windows: Named pipes auto-cleanup by OS

### 8. Zero External Dependencies

Uses only Node.js core modules to minimize supply chain risks:

- `net` - Unix domain sockets / Named pipes
- `crypto` - HMAC-SHA256 authentication
- `zlib` - Optional compression
- `fs` - Socket file cleanup (Unix)

All are Node.js built-ins, maintained by the Node.js project.

## Best Practices

### Development

1. **Use HMAC in CI/CD**

   ```bash
   export EPHEMERAL_SECRET=$(openssl rand -hex 32)
   npx ephemeral-broker start -- npm test
   ```

2. **Set appropriate TTLs**

   ```javascript
   // Short-lived test data
   await client.set('temp-token', token, 5000) // 5 seconds

   // Test session data
   await client.set('session', data, 300000) // 5 minutes
   ```

3. **Monitor memory usage**

   ```javascript
   const stats = await client.stats()
   if (stats.items > 5000) {
     console.warn('Broker has', stats.items, 'items - possible leak')
   }
   ```

4. **Keep values small** - Tokens, session IDs, config blobs. Don't store large binaries.

5. **Rotate secrets** - Rotate `EPHEMERAL_SECRET` between runs in CI.

### CI/CD Security

```yaml
# GitHub Actions example
- name: Run tests with ephemeral broker
  env:
    EPHEMERAL_SECRET: ${{ secrets.EPHEMERAL_SECRET }}
  run: |
    npx ephemeral-broker start -- npm test
```

**Checklist:**

- ✅ Set `EPHEMERAL_SECRET` as repository secret
- ✅ Enable HMAC auth in broker config
- ✅ Use short TTLs (test duration only)
- ✅ Monitor broker memory in long-running suites

### Containerized Environments

**Mount pipe directory as private:**

```yaml
# Docker Compose
services:
  tests:
    volumes:
      - /tmp:/tmp:rw,mode=0700
```

**What this prevents**: Other containers accessing broker socket.

### Production Considerations

**⚠️ Ephemeral-broker is NOT designed for production use.**

For production secrets management:

- Use **HashiCorp Vault** for dynamic secrets
- Use **AWS Secrets Manager** or **Azure Key Vault** for cloud environments
- Use **Kubernetes Secrets** for containerized workloads

Ephemeral-broker is for:

- ✅ Local development
- ✅ Test coordination (CI/CD)
- ✅ Parallel worker state sharing
- ❌ Production secrets storage
- ❌ Long-term credential management

## Common Pitfalls

### Orphaned Sockets

**Problem**: Process crashes, leaving stale `.sock` files

**Solution**: Broker automatically detects and removes stale sockets on Unix. Manually clean up if needed:

```bash
rm -f /tmp/broker-*.sock
```

### Windows Permissions

**Problem**: Some environments require elevated rights for Named Pipes

**Solution**: Run broker and clients in the same elevation context (both elevated or both normal).

### Multi-Host CI

**Problem**: Broker only works per host; cross-machine state needs different solution

**Solution**: Use Redis, Vault, or cloud-native secrets management for multi-host coordination.

## Vulnerability Reporting

If you discover a security vulnerability in ephemeral-broker:

1. **Do NOT** open a public GitHub issue
2. Open a private security advisory: https://github.com/kwegrz/ephemeral-broker/security/advisories/new
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work with you to address the issue.

## Security Updates

Security fixes will be released as patch versions:

- **Critical**: `1.0.x` → `1.0.x+1` (within 24 hours)
- **High**: `1.0.x` → `1.0.x+1` (within 1 week)
- **Medium**: `1.0.x` → `1.0.x+1` (next release)
- **Low**: Documented in CHANGELOG, fixed in next minor

Subscribe to releases: https://github.com/kwegrz/ephemeral-broker/releases

## Compliance

Ephemeral-broker is designed to help with:

- ✅ **PCI-DSS**: No secrets on disk (Requirement 3.4)
- ✅ **SOC 2**: Ephemeral data, automatic cleanup
- ✅ **GDPR**: Data minimization, automatic expiration

However, ephemeral-broker itself is **not certified**. Use appropriate controls around it.

## Secure Defaults

| Feature             | Default       | Rationale                              |
| ------------------- | ------------- | -------------------------------------- |
| **requireTTL**      | `true`        | Prevents memory leaks, limits exposure |
| **HMAC auth**       | Optional      | Balance security vs usability          |
| **Socket perms**    | `0700` (Unix) | Owner-only access                      |
| **maxItems**        | `10000`       | Prevents memory exhaustion             |
| **maxValueSize**    | `256 KB`      | Limits attack surface                  |
| **sweeperInterval** | `30000 ms`    | Regular cleanup of expired data        |

To change defaults, explicitly configure:

```javascript
const broker = new Broker({
  requireTTL: false, // ⚠️ Only for testing
  secret: 'my-secret', // ✅ Enable HMAC
  maxItems: 1000, // ✅ Stricter limit
  sweeperInterval: 10000 // ✅ More frequent cleanup
})
```

## Future Security Work

- TLS/mTLS transport option (for optional TCP mode)
- Automatic secret rotation hooks
- Audit logging of broker requests
- Pluggable auth providers beyond HMAC
