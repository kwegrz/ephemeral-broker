export class Logger {
  constructor(options = {}) {
    this.options = {
      level: options.level || 'info',
      structured: options.structured !== undefined ? options.structured : false,
      component: options.component || 'broker'
    }

    // Define log levels and their priorities
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    }

    this.currentLevelPriority = this.levels[this.options.level] ?? 1
  }

  shouldLog(level) {
    const levelPriority = this.levels[level] ?? 1
    return levelPriority >= this.currentLevelPriority
  }

  formatMessage(level, message, metadata = {}) {
    if (this.options.structured) {
      return JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        component: this.options.component,
        message,
        ...metadata
      })
    } else {
      const prefix = `[${this.options.component}]`
      if (Object.keys(metadata).length > 0) {
        const metaStr = Object.entries(metadata)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
        return `${prefix} ${message} (${metaStr})`
      }
      return `${prefix} ${message}`
    }
  }

  debug(message, metadata) {
    if (!this.shouldLog('debug')) return
    console.log(this.formatMessage('debug', message, metadata))
  }

  info(message, metadata) {
    if (!this.shouldLog('info')) return
    console.log(this.formatMessage('info', message, metadata))
  }

  warn(message, metadata) {
    if (!this.shouldLog('warn')) return
    console.warn(this.formatMessage('warn', message, metadata))
  }

  error(message, metadata) {
    if (!this.shouldLog('error')) return
    console.error(this.formatMessage('error', message, metadata))
  }
}
