// Type definitions for ephemeral-broker
// Project: https://github.com/kwegrz/ephemeral-broker

import { ChildProcess } from 'node:child_process'

/**
 * Broker configuration options
 */
export interface BrokerOptions {
  /** Enable debug logging @default false */
  debug?: boolean
  /** Require TTL for all keys @default true */
  requireTTL?: boolean
  /** Default TTL in milliseconds @default 1800000 (30 minutes) */
  defaultTTL?: number
  /** Maximum number of items in store @default 10000 */
  maxItems?: number
  /** Maximum request size in bytes @default 1048576 (1 MB) */
  maxRequestSize?: number
  /** Maximum value size in bytes @default 262144 (256 KB) */
  maxValueSize?: number
  /** HMAC secret for authentication @default null */
  secret?: string | null
  /** Enable gzip compression @default true */
  compression?: boolean
  /** Compression threshold in bytes @default 1024 */
  compressionThreshold?: number
  /** TTL sweeper interval in milliseconds @default 30000 */
  sweeperInterval?: number
  /** Auto-shutdown after idle milliseconds @default null */
  idleTimeout?: number | null
  /** Heartbeat logging interval in milliseconds @default null */
  heartbeatInterval?: number | null
  /** Log level @default 'info' */
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  /** Enable JSON structured logging @default false */
  structuredLogging?: boolean
  /** Enable metrics collection @default true */
  metrics?: boolean
  /** Custom pipe ID */
  pipeId?: string
  /** Drain period in milliseconds @default 5000 */
  drainPeriod?: number
}

/**
 * Client configuration options
 */
export interface ClientOptions {
  /** Enable debug logging @default false */
  debug?: boolean
  /** Request timeout in milliseconds @default 5000 */
  timeout?: number
  /** Allow set() without TTL @default false */
  allowNoTtl?: boolean
  /** HMAC secret for authentication @default null */
  secret?: string | null
  /** Enable compression @default true */
  compression?: boolean
  /** Compression threshold in bytes @default 1024 */
  compressionThreshold?: number
}

/**
 * Broker statistics
 */
export interface BrokerStats {
  items: number
  leases: number
  memory: {
    rss: number
    heapUsed: number
    approximateStoreBytes: number
  }
  uptime: number
}

/**
 * Broker health status
 */
export interface BrokerHealth {
  ok: boolean
  status: 'healthy' | 'unhealthy'
  uptime: number
  items: number
  leases: number
}

/**
 * Broker performance metrics
 */
export interface BrokerMetrics {
  requests: {
    total: number
    get: number
    set: number
    del: number
    list: number
    ping: number
    stats: number
    health: number
    metrics: number
    lease: number
    release: number
  }
  errors: {
    total: number
    not_found: number
    expired: number
    too_large: number
    max_items: number
    auth_failed: number
    invalid_json: number
    unknown_action: number
  }
  latency: {
    p50: number
    p95: number
    p99: number
  }
}

/**
 * Broker class - manages the IPC server
 */
export class Broker {
  constructor(options?: BrokerOptions)
  start(): Promise<string>
  stop(): void
  spawn(command: string, args?: string[]): ChildProcess
  drain(timeout?: number): Promise<void>
  setupSignalHandlers(): void
}

/**
 * Client class - connects to broker and performs operations
 */
export class Client {
  constructor(pipe?: string, options?: ClientOptions)
  get<T = unknown>(key: string): Promise<T>
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<boolean>
  del(key: string): Promise<boolean>
  list(): Promise<string[]>
  ping(): Promise<number>
  stats(): Promise<BrokerStats>
  health(): Promise<BrokerHealth>
  metrics(): Promise<BrokerMetrics>
  lease(key: string, workerId: string, ttl?: number): Promise<number>
  release(workerId: string): Promise<boolean>
}

export { makePipePath, cleanupPipe } from './pipe-utils.js'
