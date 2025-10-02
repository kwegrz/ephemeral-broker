import { ChildProcess } from 'node:child_process'
import { Server } from 'node:net'

export interface BrokerOptions {
  defaultTTL?: number
  debug?: boolean
  maxRequestSize?: number
  maxValueSize?: number
  maxItems?: number
  pipeId?: string
  secret?: string
  requireTTL?: boolean
  idleTimeout?: number | null
  heartbeatInterval?: number | null
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  structuredLogging?: boolean
  compression?: boolean
  compressionThreshold?: number
  metrics?: boolean
}

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

export interface BrokerHealth {
  ok: boolean
  status: string
  uptime: number
  timestamp: number
  memory: {
    rss: number
    heapUsed: number
    heapTotal: number
  }
  connections: {
    inFlight: number
    draining: boolean
  }
}

export class Broker {
  options: Required<Omit<BrokerOptions, 'pipeId'>> & { pipeId?: string }
  pipe: string
  logger: import('./logger.js').Logger
  metrics: import('./metrics.js').Metrics
  store: Map<string, { value: any; expires: number }>
  leases: Map<string, { key: string; value: number; expires: number }>
  server: Server | null
  child: ChildProcess | null
  sweeperInterval: NodeJS.Timeout | null
  idleCheckInterval: NodeJS.Timeout | null
  heartbeatInterval: NodeJS.Timeout | null
  startTime: number | null
  lastActivity: number | null
  signalHandlers: Map<string, () => void>
  draining: boolean
  inFlightRequests: number
  requestCounter: number

  constructor(options?: BrokerOptions)

  start(): Promise<string>
  setupSignalHandlers(): void
  drain(timeout?: number): Promise<void>
  checkIfBrokerRunning(): Promise<boolean>
  handleConnection(socket: import('node:net').Socket): void
  processMessage(line: string, socket: import('node:net').Socket): Promise<void>
  validateHMAC(msg: any): boolean
  compressValue(value: any): Promise<string>
  decompressValue(compressed: string): Promise<any>
  handleGet(msg: { key: string }): { ok: boolean; value?: any; compressed?: boolean; error?: string }
  handleSet(msg: { key: string; value: any; ttl?: number; compressed?: boolean; beforeSize?: number; afterSize?: number }): Promise<{ ok: boolean; error?: string }>
  handleDel(msg: { key: string }): { ok: boolean }
  handleList(): { ok: boolean; items: Record<string, { expires: number; hasValue: boolean }> }
  handleHealth(): BrokerHealth
  handleMetrics(): { ok: boolean; metrics: string; format: string }
  handleLease(msg: { key: string; workerId: string; ttl?: number }): { ok: boolean; value?: number; error?: string }
  handleRelease(msg: { workerId: string }): { ok: boolean; released?: boolean; error?: string }
  handleStats(): { ok: boolean; stats: BrokerStats }
  spawn(command: string, args?: string[]): ChildProcess
  startSweeper(): void
  startIdleChecker(): void
  startHeartbeat(): void
  logHeartbeat(): void
  checkIdleTimeout(): void
  shutdownDueToIdle(): Promise<void>
  sweepExpired(): void
  stop(): void
}
