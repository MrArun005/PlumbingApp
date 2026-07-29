/**
 * Structured logging only (BUILD-PROMPT rule 10). Every log line inside a
 * request carries the trace id via AsyncLocalStorage — no manual threading.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import pino from 'pino';

const als = new AsyncLocalStorage<{ traceId: string }>();

export function createLogger(level: string): pino.Logger {
  return pino({
    level,
    base: { service: 'pipefix-api' },
    mixin: () => ({ traceId: als.getStore()?.traceId }),
  });
}

/** Express middleware: open an ALS scope with a trace id per request. */
export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
  res.setHeader('x-trace-id', traceId);
  als.run({ traceId }, next);
}

export function currentTraceId(): string | undefined {
  return als.getStore()?.traceId;
}
