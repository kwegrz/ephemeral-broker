export interface MetricsOptions {
  enabled?: boolean
}

export interface OperationMetric {
  total: number
  errors: number
}

export interface CompressionMetrics {
  compressed: number
  uncompressed: number
  bytesBeforeCompression: number
  bytesAfterCompression: number
}

export interface StorageMetrics {
  itemsExpired: number
  leasesExpired: number
}

export interface RequestMetrics {
  total: number
  inFlight: number
  draining: number
}

export class Metrics {
  options: Required<MetricsOptions>
  operations: {
    get: OperationMetric
    set: OperationMetric
    del: OperationMetric
    list: OperationMetric
    ping: OperationMetric
    stats: OperationMetric
    health: OperationMetric
    lease: OperationMetric
    release: OperationMetric
  }
  compression: CompressionMetrics
  storage: StorageMetrics
  requests: RequestMetrics

  constructor(options?: MetricsOptions)

  recordOperation(action: string, success?: boolean): void
  recordCompression(beforeSize: number, afterSize: number): void
  recordUncompressed(): void
  recordExpired(items: number, leases: number): void
  recordRequest(inFlight: number, draining: boolean): void
  getCompressionRatio(): number
  toPrometheusFormat(): string
  reset(): void
}
