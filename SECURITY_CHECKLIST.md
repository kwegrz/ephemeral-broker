# Security Checklist for Ephemeral Broker

## Pre-Production Security Review

### Authentication & Access Control

- [ ] ✅ HMAC authentication uses timing-safe comparison (`crypto.timingSafeEqual`)
- [ ] ✅ HMAC uses SHA-256 (cryptographically secure hash)
- [ ] ✅ Secret can be provided via environment variable (`EPHEMERAL_SECRET`)
- [ ] ✅ Authentication tests cover valid/invalid/missing HMAC scenarios
- [ ] ✅ Unix domain socket permissions set to 0700 (owner-only)
- [ ] ✅ Random pipe names prevent predictable socket paths

### Input Validation & Size Limits

- [ ] ✅ Maximum request size: 1MB (configurable via `maxRequestSize`)
- [ ] ✅ Maximum value size: 256KB (configurable via `maxValueSize`)
- [ ] ✅ Maximum item count: 10,000 (configurable via `maxItems`)
- [ ] ✅ TTL required by default (`requireTTL: true`)
- [ ] ✅ Invalid TTL values (0, negative) are rejected
- [ ] ✅ JSON parsing errors handled gracefully

### Memory & Resource Management

- [ ] ✅ TTL sweeper runs every 30 seconds to clean expired entries
- [ ] ✅ Expired items don't count against `maxItems` limit
- [ ] ✅ Compression available for large values (reduces memory footprint)
- [ ] ✅ Graceful shutdown clears all in-memory data
- [ ] ✅ No memory leaks from unclosed connections (tracked via `inFlightRequests`)

### Network & Protocol Security

- [ ] ✅ Uses Unix domain sockets (not network sockets) - single-host only
- [ ] ✅ Newline-delimited JSON protocol (simple, no complex parsing)
- [ ] ✅ No external dependencies (zero supply chain risk)
- [ ] ✅ Socket cleanup on graceful shutdown (`cleanupPipe()`)
- [ ] ✅ Stale socket detection and removal on startup

### Error Handling & Information Disclosure

- [ ] ✅ Authentication failures return generic `auth_failed` error
- [ ] ✅ No stack traces or sensitive info in error messages
- [ ] ✅ Request errors logged with correlation IDs (for debugging)
- [ ] ✅ Structured logging available for production monitoring

### Operational Security

- [ ] ✅ No disk persistence (all data in-memory only)
- [ ] ✅ Secrets cleared from memory on broker shutdown
- [ ] ✅ SIGINT/SIGTERM handlers for graceful shutdown
- [ ] ✅ Drain mechanism prevents data loss during shutdown
- [ ] ✅ Idle timeout option for automatic cleanup (optional)

### Dependencies & Vulnerabilities

- [ ] ✅ `npm audit` reports 0 vulnerabilities
- [ ] ✅ Uses only Node.js core modules (`net`, `crypto`, `fs`, `zlib`, `child_process`)
- [ ] ✅ No production dependencies in `package.json`
- [ ] ✅ Dev dependencies are linting/testing tools only

### Testing Coverage

- [ ] ✅ HMAC authentication tests (valid, invalid, missing)
- [ ] ✅ TTL expiration tests
- [ ] ✅ Size limit enforcement tests
- [ ] ✅ Compression functionality tests
- [ ] ✅ Graceful shutdown tests
- [ ] ✅ Connection error handling tests
- [ ] ✅ Drain behavior tests
- [ ] ✅ Lease/release concurrency tests

## Deployment Recommendations

### Production Configuration

```javascript
const broker = new Broker({
  secret: process.env.EPHEMERAL_SECRET, // Always use HMAC in production
  requireTTL: true, // Enforce TTL on all keys
  maxItems: 10000, // Limit total items
  maxValueSize: 256_000, // 256KB max per value
  maxRequestSize: 1_000_000, // 1MB max request
  compression: true, // Enable compression for large values
  compressionThreshold: 1024, // Compress values > 1KB
  logLevel: 'info', // Production logging
  structuredLogging: true, // JSON logs for log aggregation
  idleTimeout: 3600000, // Optional: 1 hour idle shutdown
  heartbeatInterval: 60000 // Optional: 1 minute heartbeat
})
```

### Environment Variables

- `EPHEMERAL_SECRET`: Set a strong, random secret (min 32 bytes recommended)
- `EPHEMERAL_PIPE`: Not needed (auto-generated), but can override for testing
- Rotate `EPHEMERAL_SECRET` between broker restarts
- Never commit secrets to version control

### Container/CI Environment

- Mount `/tmp` or pipe directory as private volume
- Set umask to 0077 for restrictive file permissions
- Use non-root user to run broker process
- Enable resource limits (memory, CPU) via container runtime
- Monitor via `/metrics` endpoint (Prometheus format)

### Multi-Host Considerations

- ⚠️ Broker is **single-host only** (uses Unix domain sockets)
- For multi-host coordination, use Redis/Vault/etcd instead
- Each host can run its own broker instance independently
- No cross-process/cross-container sharing unless shared filesystem

## Security Incident Response

### If Secret is Compromised

1. Stop the broker immediately (`broker.stop()`)
2. Generate new `EPHEMERAL_SECRET`
3. Restart broker with new secret
4. Update all clients with new secret
5. Review logs for unauthorized access

### If Unauthorized Access Suspected

1. Check broker logs for `auth_failed` errors
2. Verify Unix socket permissions: `ls -la /tmp/broker-*.sock`
3. Ensure broker is running as correct user
4. Review process list for unexpected clients
5. Restart broker with fresh secret

## Regular Security Maintenance

### Weekly

- [ ] Review `npm audit` output
- [ ] Check for Node.js security updates
- [ ] Review broker logs for anomalies

### Monthly

- [ ] Rotate EPHEMERAL_SECRET
- [ ] Review and update dependencies (dev only)
- [ ] Test backup/recovery procedures

### Quarterly

- [ ] Full security audit
- [ ] Penetration testing (if applicable)
- [ ] Review and update threat model

## Known Limitations (Out of Scope)

- ❌ Not suitable for cross-host secret sharing
- ❌ Not suitable for long-term secret storage
- ❌ No protection against root-level attackers
- ❌ No built-in encryption at rest (data is in-memory only)
- ❌ No network transport (Unix domain sockets only)
- ❌ No audit logging of individual operations (only metrics/health)

For these use cases, consider:

- **Cross-host**: Redis, Vault, etcd
- **Long-term storage**: HashiCorp Vault, AWS KMS, Azure Key Vault
- **Audit logging**: Integrate with SIEM/log aggregation platform
