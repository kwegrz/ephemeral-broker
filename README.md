Ephemeral Pipe Broker

Fast, secure, ephemeral IPC over pipes.
Share secrets, tokens, and small state between parallel processes without touching disk or opening ports. Cleans itself up automatically when your process exits.

⸻

Core Value Props 1. One Thing Well — A temporary KV/lease store over pipes. That’s it. 2. Zero Dependencies — Core uses only Node built-ins. 3. Security First — HMAC auth, size limits, TTL required by default. 4. Plugin Architecture — Extend without bloating core. 5. Cross-Platform — Works the same on Mac, Linux, and Windows.

⸻

Why

Most modern dev/test environments run into the same problems:
• Secrets on disk → API keys, STS creds, and OAuth tokens end up written to .env or cache files.
• Parallel worker collisions → WDIO, Playwright, Jest, etc. spawn many workers with no safe way to share ephemeral state.
• Lifecycle pollution → bootstrap state lingers after jobs, causing flaky tests and security risks.

Ephemeral Pipe Broker solves this:
• Starts before your process.
• Exposes a random local pipe (/tmp/…sock or \\.\pipe\…).
• Brokers secrets/state in memory only.
• Wipes itself clean on exit.

⸻

Install

npm install --save-dev ephemeral-pipe-broker ephemeral-pipe-client

⸻

Quickstart

1. Spawn broker with your command

npx ephemeral-pipe-broker start -- pnpm test

Broker:
• generates a random pipe,
• exports it to child as EPHEMERAL_PIPE,
• spawns your command,
• exits + wipes memory when done.

2. Use the client

import { PipeClient } from 'ephemeral-pipe-client';

const client = new PipeClient(process.env.EPHEMERAL_PIPE);

// Set a value with TTL
await client.set('foo', 'bar', 60000);
console.log(await client.get('foo')); // "bar"

// Lease tokens per worker
const token = await client.lease('publisher-api', process.env.WORKER_ID);

3. With adapter (WDIO example)

import { withBrokerTokens } from '@ephemeral-broker/wdio';

export const config = withBrokerTokens({
tokens: {
publisher: 'publisher-api-token',
admin: 'admin-api-token'
},
envVars: true
}, baseConfig);

⸻

CLI Usage

# Simple: run tests with broker

npx ephemeral-pipe-broker start -- pnpm test

# With plugin

epb start --plugin @ephemeral-broker/aws-sts -- pnpm test

# Debug mode

epb start --debug --auth $SECRET -- pnpm test

⸻

Client API

class PipeClient {
constructor(pipe?: string, options?: { auth?: string, timeout?: number })

get(key: string): Promise<any>
set(key: string, value: any, ttlMs?: number): Promise<void>
del(key: string): Promise<void>

lease(key: string, workerId?: string, ttlMs?: number): Promise<any>
renew(workerId?: string): Promise<any>
release(workerId?: string): Promise<void>

stats(): Promise<{ items: number, leases: number, memory: number, uptime: number }>
ping(): Promise<boolean>
}

⸻

Adapters & Plugins
• @ephemeral-broker/wdio – WDIO integration (leases tokens per worker, auto-renew, release on exit).
• @ephemeral-broker/aws-sts – AWS STS plugin (mint + cache creds in memory).
• Upcoming:
• @ephemeral-broker/playwright
• @ephemeral-broker/jest
• @ephemeral-broker/testcafe
• @ephemeral-broker/rate-limit
• @ephemeral-broker/mock

⸻

Publishing Strategy

# Phase 1: Core

npm publish ephemeral-pipe-broker
npm publish ephemeral-pipe-client

# Phase 2: Immediate adapter

npm publish @ephemeral-broker/wdio

# Phase 3: Common asks

npm publish @ephemeral-broker/aws-sts
npm publish @ephemeral-broker/rate-limit

# Phase 4: Ecosystem

@ephemeral-broker/playwright
@ephemeral-broker/jest
@ephemeral-broker/mock

⸻

Usage Patterns
• Testing: WDIO, Playwright, TestCafe, Jest workers share tokens + fixtures.
• CI/CD: distribute secrets, share build state, coordinate artifacts (same runner).
• Dev Tools: ESLint/Prettier caches, hot reload flags, monorepo build state.
• Security-Sensitive Apps: OAuth broker, AWS STS, temporary creds.

⸻

Performance

Tested on Apple M1 Max, Node.js v22.17.0:

| Operation | Ops/sec | P50 (ms) | P95 (ms) | P99 (ms) |
| --------- | ------- | -------- | -------- | -------- |
| SET       | 12,285  | 0        | 1        | 1        |
| GET       | 26,882  | 0        | 0        | 1        |
| DEL       | 26,042  | 0        | 0        | 1        |
| PING      | 27,027  | 0        | 0        | 1        |

Memory: ~1,566 bytes per item

See [BENCHMARKS.md](./BENCHMARKS.md) for details and how to run benchmarks on your system.

⸻

Why This Will Succeed 1. Solves real pain — tokens on disk, port conflicts, worker collisions. 2. Simple mental model — just a temp KV/lease store over a pipe. 3. Easy adoption — npx ephemeral-pipe-broker start -- your-command. 4. Framework-agnostic — not tied to WDIO or any specific stack. 5. Safe defaults — LRU, TTL, auth, caps, heartbeat all built-in.

This isn't another heavy service. It's essential infrastructure in ~200 LOC.
