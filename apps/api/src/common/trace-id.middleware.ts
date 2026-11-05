import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** traceId taşınan istek tipi (module augmentation yerine açık tiplendirme). */
export type RequestWithTrace = Request & { traceId?: string };

/**
 * Her isteğe benzersiz traceId atar; hata zarfı ve log korelasyonu için kullanılır.
 * Yanıtta X-Trace-Id başlığına da yazar.
 */
export function traceIdMiddleware(req: RequestWithTrace, res: Response, next: NextFunction): void {
  const headerTrace = req.headers['x-trace-id'];
  const traceId = typeof headerTrace === 'string' && headerTrace.length > 0 ? headerTrace : randomUUID();
  req.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
}
