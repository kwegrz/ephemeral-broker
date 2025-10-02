# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Observability & Monitoring** (#36)
  - Prometheus metrics endpoint (`/metrics`) with operation counters, compression stats, and request tracking
  - Metrics class for tracking operations, compression ratio, storage, and request metrics
  - `client.metrics()` method to retrieve Prometheus-format metrics
  - Configurable metrics via `metrics: boolean` option (default: `true`)

- **Message Compression** (#35)
  - Transparent gzip compression for large values (configurable threshold, default 1KB)
  - Automatic compression/decompression with `compressed` protocol flag
  - Compression metrics tracking (bytes before/after, compression ratio)
  - Options: `compression: boolean`, `compressionThreshold: number`

- **Structured Logging** (#34)
  - JSON structured logging with log level filtering (debug, info, warn, error)
  - Correlation IDs for request tracing (`timestamp-counter` format)
  - Logger class supporting both structured and human-readable output
  - Options: `logLevel: string`, `structuredLogging: boolean`

- **Health Checks & Heartbeat** (#33)
  - Health endpoint with process metrics (uptime, memory, connections)
  - `client.health()` method returning detailed health status
  - Optional heartbeat logging for monitoring
  - Options: `heartbeatInterval: number`

- **Idle Shutdown** (#32)
  - Automatic broker shutdown after idle period
  - Activity tracking with `lastActivity` timestamp
  - Configurable idle timeout with periodic checking
  - Options: `idleTimeout: number`, `idleCheckInterval: number`

- **Core Features**
  - Lease/release mechanism for parallel worker coordination
  - HMAC authentication with SHA-256 and constant-time comparison
  - Graceful shutdown with drain period for in-flight requests
  - TTL enforcement by default (`requireTTL: true`)
  - Max items limit (default: 10,000) to prevent unbounded memory growth
  - Stats endpoint for broker visibility
  - CLI binaries: `ephemeral-broker` and `brokerctl`
  - Connection retry with exponential backoff (50ms to 800ms)
  - Cross-platform support (Windows Named Pipes, Unix domain sockets)
  - TypeScript declaration files for all APIs
  - ESLint and Prettier configuration with pre-commit hooks

### Changed

- Socket permissions now enforced to 0700 on Unix systems (breaking: was 755)
- `requireTTL` now defaults to `true` (breaking: was `false`)
- Debug mode now sets log level to 'debug' automatically

### Security

- **CRITICAL FIX**: Unix socket permissions enforced to 0700 (owner-only access) (#31)
- Added timing-safe HMAC comparison to prevent timing attacks
- Documented security best practices and threat model
- Created comprehensive `SECURITY_CHECKLIST.md` for production deployments
- Added incident response procedures
- npm audit: 0 vulnerabilities
- Zero external dependencies (supply chain security)

### Documentation

- Added `SECURITY_CHECKLIST.md` with pre-production security review
- Enhanced `SECURITY.md` with deployment recommendations
- Added comprehensive `ARCHITECTURE.md`
- Documented all configuration options
- Added example usage patterns

## [0.0.1] - 2025-10-01

### Added
- Initial implementation
