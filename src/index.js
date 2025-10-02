export { Broker } from './broker.js'
export { Client } from './client.js'
export { makePipePath, cleanupPipe } from './pipe-utils.js'

/**
 * Readiness check helper for Kubernetes probes
 * Returns true if broker is healthy, false otherwise
 *
 * @param {string} pipePath - Optional pipe path (defaults to EPHEMERAL_PIPE env var)
 * @param {number} timeout - Timeout in milliseconds (default: 2000)
 * @returns {Promise<boolean>}
 *
 * @example
 * // In K8s readiness probe script:
 * import { checkReadiness } from '@ephemeral-broker/core'
 * const ready = await checkReadiness()
 * process.exit(ready ? 0 : 1)
 */
export async function checkReadiness(pipePath, timeout = 2000) {
  try {
    const { Client } = await import('./client.js')
    const client = new Client(pipePath, { timeout })
    const health = await client.health()
    return health.status === 'healthy'
  } catch {
    return false
  }
}
