export interface ClientOptions {
  timeout?: number
  debug?: boolean
  allowNoTtl?: boolean
}

export interface Stats {
  items: number
  leases: number
  memory: {
    rss: number
    heapUsed: number
    approximateStoreBytes: number
  }
  uptime: number
}

export class Client {
  pipe: string
  options: Required<ClientOptions>

  constructor(pipe?: string, options?: ClientOptions)

  request(payload: {
    action: string
    key?: string
    value?: any
    ttl?: number
  }): Promise<{ ok: boolean; value?: any; items?: any; pong?: number; stats?: Stats; error?: string }>

  get(key: string): Promise<any>
  set(key: string, value: any, ttl?: number): Promise<boolean>
  del(key: string): Promise<boolean>
  list(): Promise<Record<string, { expires: number; hasValue: boolean }>>
  ping(): Promise<number>
  stats(): Promise<Stats>
}
