export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export class Logger {
  private verbose = false
  
  setVerbose(verbose: boolean) {
    this.verbose = verbose
  }
  
  debug(message: string, ...args: unknown[]) {
    if (this.verbose) {
      console.log(`[DEBUG] ${message}`, ...args)
    }
  }
  
  info(message: string, ...args: unknown[]) {
    console.log(`[INFO] ${message}`, ...args)
  }
  
  warn(message: string, ...args: unknown[]) {
    console.warn(`[WARN] ${message}`, ...args)
  }
  
  error(message: string, ...args: unknown[]) {
    console.error(`[ERROR] ${message}`, ...args)
  }
}

export const logger = new Logger()