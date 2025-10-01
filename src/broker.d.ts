import { ChildProcess } from 'node:child_process'
import { Server } from 'node:net'

export interface BrokerOptions {
  defaultTTL?: number
  debug?: boolean
  maxRequestSize?: number
  maxValueSize?: number
  pipeId?: string
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

export class Broker {
  options: Required<Omit<BrokerOptions, 'pipeId'>> & { pipeId?: string }
  pipe: string
  store: Map<string, { value: any; expires: number }>
  server: Server | null
  child: ChildProcess | null
  sweeperInterval: NodeJS.Timeout | null
  startTime: number | null

  constructor(options?: BrokerOptions)

  start(): Promise<string>
  checkIfBrokerRunning(): Promise<boolean>
  handleConnection(socket: import('node:net').Socket): void
  processMessage(line: string, socket: import('node:net').Socket): Promise<void>
  handleGet(msg: { key: string }): { ok: boolean; value?: any; error?: string }
  handleSet(msg: { key: string; value: any; ttl?: number }): { ok: boolean; error?: string }
  handleDel(msg: { key: string }): { ok: boolean }
  handleList(): { ok: boolean; items: Record<string, { expires: number; hasValue: boolean }> }
  handleStats(): { ok: boolean; stats: BrokerStats }
  spawn(command: string, args?: string[]): ChildProcess
  startSweeper(): void
  sweepExpired(): void
  stop(): void
}
