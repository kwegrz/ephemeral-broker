import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'

export function makePipePath(id) {
  const random = id || crypto.randomBytes(6).toString('hex')
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\broker-${random}`
  }
  return path.join(os.tmpdir(), `broker-${random}.sock`)
}

export function cleanupPipe(pipePath) {
  // Only need to clean up on Unix
  if (process.platform !== 'win32' && fs.existsSync(pipePath)) {
    try {
      fs.unlinkSync(pipePath)
    } catch (err) {
      console.warn(`Failed to cleanup pipe: ${err.message}`)
    }
  }
}