import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'

export function makePipePath(id) {
  const random = id || crypto.randomBytes(6).toString('hex')

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\broker-${random}`
  }

  // Unix domain sockets have a max path length of 108 bytes (UNIX_PATH_MAX)
  const pipePath = path.join(os.tmpdir(), `broker-${random}.sock`)

  if (pipePath.length >= 108) {
    throw new Error(
      `Pipe path too long (${pipePath.length} >= 108 chars): ${pipePath}\n` +
        'Unix domain sockets are limited to 108 bytes. Try setting TMPDIR to a shorter path.'
    )
  }

  return pipePath
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
