export class Metrics {
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled !== undefined ? options.enabled : true
    }

    // Operation counters
    this.operations = {
      get: { total: 0, errors: 0 },
      set: { total: 0, errors: 0 },
      del: { total: 0, errors: 0 },
      list: { total: 0, errors: 0 },
      ping: { total: 0, errors: 0 },
      stats: { total: 0, errors: 0 },
      health: { total: 0, errors: 0 },
      lease: { total: 0, errors: 0 },
      release: { total: 0, errors: 0 }
    }

    // Compression metrics
    this.compression = {
      compressed: 0,
      uncompressed: 0,
      bytesBeforeCompression: 0,
      bytesAfterCompression: 0
    }

    // Storage metrics
    this.storage = {
      itemsExpired: 0,
      leasesExpired: 0
    }

    // Request metrics
    this.requests = {
      total: 0,
      inFlight: 0,
      draining: 0
    }
  }

  recordOperation(action, success = true) {
    if (!this.options.enabled) return

    if (this.operations[action]) {
      this.operations[action].total++
      if (!success) {
        this.operations[action].errors++
      }
    }
  }

  recordCompression(beforeSize, afterSize) {
    if (!this.options.enabled) return

    this.compression.compressed++
    this.compression.bytesBeforeCompression += beforeSize
    this.compression.bytesAfterCompression += afterSize
  }

  recordUncompressed() {
    if (!this.options.enabled) return

    this.compression.uncompressed++
  }

  recordExpired(items, leases) {
    if (!this.options.enabled) return

    this.storage.itemsExpired += items
    this.storage.leasesExpired += leases
  }

  recordRequest(inFlight, draining) {
    if (!this.options.enabled) return

    this.requests.total++
    this.requests.inFlight = inFlight
    this.requests.draining = draining ? 1 : 0
  }

  getCompressionRatio() {
    if (this.compression.bytesBeforeCompression === 0) return 0
    return this.compression.bytesAfterCompression / this.compression.bytesBeforeCompression
  }

  toPrometheusFormat() {
    const lines = []

    // Operation counters
    lines.push('# HELP ephemeral_broker_operations_total Total number of operations by type')
    lines.push('# TYPE ephemeral_broker_operations_total counter')
    for (const [action, stats] of Object.entries(this.operations)) {
      lines.push(
        `ephemeral_broker_operations_total{action="${action}",result="success"} ${stats.total - stats.errors}`
      )
      lines.push(
        `ephemeral_broker_operations_total{action="${action}",result="error"} ${stats.errors}`
      )
    }

    // Compression metrics
    lines.push('# HELP ephemeral_broker_compression_total Total values compressed/uncompressed')
    lines.push('# TYPE ephemeral_broker_compression_total counter')
    lines.push(
      `ephemeral_broker_compression_total{compressed="true"} ${this.compression.compressed}`
    )
    lines.push(
      `ephemeral_broker_compression_total{compressed="false"} ${this.compression.uncompressed}`
    )

    lines.push(
      '# HELP ephemeral_broker_compression_bytes_total Total bytes before/after compression'
    )
    lines.push('# TYPE ephemeral_broker_compression_bytes_total counter')
    lines.push(
      `ephemeral_broker_compression_bytes_total{stage="before"} ${this.compression.bytesBeforeCompression}`
    )
    lines.push(
      `ephemeral_broker_compression_bytes_total{stage="after"} ${this.compression.bytesAfterCompression}`
    )

    const compressionRatio = this.getCompressionRatio()
    lines.push('# HELP ephemeral_broker_compression_ratio Current compression ratio')
    lines.push('# TYPE ephemeral_broker_compression_ratio gauge')
    lines.push(`ephemeral_broker_compression_ratio ${compressionRatio.toFixed(4)}`)

    // Storage metrics
    lines.push('# HELP ephemeral_broker_expired_total Total expired items and leases')
    lines.push('# TYPE ephemeral_broker_expired_total counter')
    lines.push(`ephemeral_broker_expired_total{type="items"} ${this.storage.itemsExpired}`)
    lines.push(`ephemeral_broker_expired_total{type="leases"} ${this.storage.leasesExpired}`)

    // Request metrics
    lines.push('# HELP ephemeral_broker_requests_total Total requests processed')
    lines.push('# TYPE ephemeral_broker_requests_total counter')
    lines.push(`ephemeral_broker_requests_total ${this.requests.total}`)

    lines.push('# HELP ephemeral_broker_requests_in_flight Current in-flight requests')
    lines.push('# TYPE ephemeral_broker_requests_in_flight gauge')
    lines.push(`ephemeral_broker_requests_in_flight ${this.requests.inFlight}`)

    lines.push('# HELP ephemeral_broker_draining Whether broker is draining (1=yes, 0=no)')
    lines.push('# TYPE ephemeral_broker_draining gauge')
    lines.push(`ephemeral_broker_draining ${this.requests.draining}`)

    return lines.join('\n') + '\n'
  }

  reset() {
    // Reset all metrics (useful for testing)
    for (const action of Object.keys(this.operations)) {
      this.operations[action] = { total: 0, errors: 0 }
    }

    this.compression = {
      compressed: 0,
      uncompressed: 0,
      bytesBeforeCompression: 0,
      bytesAfterCompression: 0
    }

    this.storage = {
      itemsExpired: 0,
      leasesExpired: 0
    }

    this.requests = {
      total: 0,
      inFlight: 0,
      draining: 0
    }
  }
}
