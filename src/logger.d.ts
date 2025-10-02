export interface LoggerOptions {
  level?: 'debug' | 'info' | 'warn' | 'error'
  structured?: boolean
  component?: string
}

export class Logger {
  options: {
    level: string
    structured: boolean
    component: string
  }
  levels: {
    debug: number
    info: number
    warn: number
    error: number
  }
  currentLevelPriority: number

  constructor(options?: LoggerOptions)

  shouldLog(level: string): boolean
  formatMessage(level: string, message: string, metadata?: Record<string, any>): string
  debug(message: string, metadata?: Record<string, any>): void
  info(message: string, metadata?: Record<string, any>): void
  warn(message: string, metadata?: Record<string, any>): void
  error(message: string, metadata?: Record<string, any>): void
}
