# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial broker implementation with KV store
- Client with automatic retry and exponential backoff
- Cross-platform pipe support (Unix sockets and Windows Named Pipes)
- TTL-based expiration with automatic sweeping
- Size limits for requests and values
- Stale socket detection and cleanup
- TypeScript declaration files for better IDE support
- ESLint configuration
- GitHub Actions CI/CD workflow
- Comprehensive documentation (README, ARCHITECTURE, SECURITY, CONTRIBUTING)

### Security
- Random pipe path generation
- Optional HMAC authentication (planned)
- Strict size limits to prevent memory exhaustion
- TTL required for all entries

## [0.0.1] - 2025-10-01

### Added
- Initial implementation
