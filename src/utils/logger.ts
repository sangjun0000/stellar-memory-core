/**
 * utils/logger.ts — Structured JSON logging.
 *
 * MCP servers communicate over stdout; ALL log output MUST go to stderr so it
 * does not corrupt the protocol stream.
 *
 * Log format: one JSON object per line (newline-delimited JSON / NDJSON).
 * Each line contains at minimum: { level, ts, msg }.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO  = 1,
  WARN  = 2,
  ERROR = 3,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'debug',
  [LogLevel.INFO]:  'info',
  [LogLevel.WARN]:  'warn',
  [LogLevel.ERROR]: 'error',
};

// ---------------------------------------------------------------------------
// Logger interface
// ---------------------------------------------------------------------------

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string,  ctx?: Record<string, unknown>): void;
  warn(msg: string,  ctx?: Record<string, unknown>): void;
  error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// StellarLogger — concrete implementation writing NDJSON to stderr
// ---------------------------------------------------------------------------

export class StellarLogger implements Logger {
  private readonly minLevel: LogLevel;
  private readonly component: string;

  constructor(component: string, minLevel: LogLevel = LogLevel.INFO) {
    this.component = component;
    this.minLevel = resolveMinLevel(minLevel);
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.write(LogLevel.DEBUG, msg, undefined, ctx);
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.write(LogLevel.INFO, msg, undefined, ctx);
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.write(LogLevel.WARN, msg, undefined, ctx);
  }

  error(msg: string, err?: Error, ctx?: Record<string, unknown>): void {
    this.write(LogLevel.ERROR, msg, err, ctx);
  }

  private write(
    level: LogLevel,
    msg: string,
    err?: Error,
    ctx?: Record<string, unknown>,
  ): void {
    if (level < this.minLevel) return;

    const entry: Record<string, unknown> = {
      level:     LEVEL_NAMES[level],
      ts:        new Date().toISOString(),
      component: this.component,
      msg,
      ...ctx,
    };

    if (err) {
      entry['err'] = {
        name:    err.name,
        message: err.message,
        // Only include stack in debug/info — strip in warn/error for brevity
        ...(level <= LogLevel.INFO && err.stack ? { stack: err.stack } : {}),
      };
    }

    process.stderr.write(JSON.stringify(entry) + '\n');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read STELLAR_LOG_LEVEL env var; fallback to the passed-in default. */
function resolveMinLevel(defaultLevel: LogLevel): LogLevel {
  const envLevel = process.env['STELLAR_LOG_LEVEL']?.toLowerCase();
  switch (envLevel) {
    case 'debug': return LogLevel.DEBUG;
    case 'info':  return LogLevel.INFO;
    case 'warn':  return LogLevel.WARN;
    case 'error': return LogLevel.ERROR;
    default:      return defaultLevel;
  }
}

/** Factory — creates a logger scoped to a named component. */
export function createLogger(component: string): Logger {
  return new StellarLogger(component);
}

/** Module-level default logger (used before component-specific loggers are created). */
export const logger: Logger = createLogger('stellar-memory');
