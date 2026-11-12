import { pino } from 'pino';
import type { Config } from './config.js';

/**
 * One structured logger for the whole process. JSON in containers (so a log
 * shipper can index fields like documentId, durationMs), pretty in a dev TTY.
 */
export function createLogger(config: Config, name: string) {
  return pino({
    name,
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    ...(config.NODE_ENV === 'development' && process.stdout.isTTY
      ? { transport: { target: 'pino-pretty' } }
      : {}),
  });
}
