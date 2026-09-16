import type { CacheService } from '../cache-service.js';
import type { WrapOptions } from '../types.js';
import {
  buildDeterministicKey,
  generateETag,
  shouldSkipCache,
  type KeyDerivationOptions,
} from './utils.js';

export interface ExpressCacheOptions extends Omit<WrapOptions, 'tags'>, KeyDerivationOptions {
  /** TriCache instance. If omitted, lazily resolves the default singleton via CacheService.create(). */
  cache?: CacheService;
  /** Whether to generate and evaluate weak ETags. Default: true. */
  etag?: boolean;
  /** Custom predicate to skip caching dynamically for this request (e.g. authenticated sessions). */
  skipCache?: (req: any) => boolean;
  /** Dynamic tags derivation from request. */
  tags?: string[] | ((req: any) => string[]);
}

export interface CachedHttpResponse {
  body: unknown;
  contentType?: string;
  etag?: string;
  status: number;
}

/**
 * Creates an Express / Connect middleware that provides deterministic response caching,
 * weak ETag generation, conditional 304 Not Modified short-circuiting, and Cache-Control bypass controls.
 *
 * @example
 * import express from 'express';
 * import { CacheService } from 'tricache';
 * import { createExpressMiddleware } from 'tricache/http';
 *
 * const app = express();
 * const cache = CacheService.create();
 *
 * app.get(
 *   '/api/products',
 *   createExpressMiddleware({
 *     cache,
 *     ttl: 120,
 *     tags: ['products'],
 *     headerWhitelist: ['accept-language'],
 *   }),
 *   async (req, res) => {
 *     const data = await getProducts();
 *     res.json(data);
 *   }
 * );
 */
export function createExpressMiddleware(options: ExpressCacheOptions = {}) {
  const {
    cache,
    etag = true,
    ttl = 300,
    swr,
    tags,
    skipCache,
    keyGenerator,
    headerWhitelist,
  } = options;

  return async (req: any, res: any, next: any) => {
    // Only cache safe, idempotent HTTP read methods
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    if (shouldSkipCache(req, skipCache)) {
      return next();
    }

    let activeCache = cache;
    if (!activeCache) {
      const { CacheService } = await import('../cache-service.js');
      activeCache = CacheService.create();
    }

    const key = buildDeterministicKey(req, { keyGenerator, headerWhitelist });
    const ifNoneMatch = req.headers ? (req.headers['if-none-match'] || req.headers['If-None-Match']) : undefined;

    const resolvedTags = typeof tags === 'function' ? tags(req) : tags;

    try {
      const cached = await activeCache.get<CachedHttpResponse>(
        key,
        async () => {
          return new Promise<CachedHttpResponse>((resolve) => {
            const origJson = res.json?.bind(res);
            const origSend = res.send?.bind(res);
            const origEnd  = res.end?.bind(res);

            const getStatusCode = () => (res.statusCode ?? 200);

            if (origJson) {
              res.json = (body: any) => {
                const status = getStatusCode();
                const bodyEtag = etag ? generateETag(body) : undefined;
                const contentType = res.getHeader?.('content-type') || 'application/json; charset=utf-8';

                resolve({ body, contentType, etag: bodyEtag, status });

                if (ifNoneMatch && bodyEtag && ifNoneMatch === bodyEtag) {
                  res.status?.(304);
                  origEnd?.();
                  return;
                }

                if (bodyEtag && res.setHeader) {
                  res.setHeader('ETag', bodyEtag);
                }
                return origJson(body);
              };
            }

            if (origSend) {
              res.send = (body: any) => {
                const status = getStatusCode();
                const bodyEtag = etag ? generateETag(body) : undefined;
                const contentType = res.getHeader?.('content-type') as string | undefined;

                resolve({ body, contentType, etag: bodyEtag, status });

                if (ifNoneMatch && bodyEtag && ifNoneMatch === bodyEtag) {
                  res.status?.(304);
                  origEnd?.();
                  return;
                }

                if (bodyEtag && res.setHeader) {
                  res.setHeader('ETag', bodyEtag);
                }
                return origSend(body);
              };
            }

            if (origEnd) {
              res.end = (body?: unknown) => {
                const status = getStatusCode();
                const bodyEtag = etag && body != null ? generateETag(body) : undefined;
                const contentType = res.getHeader?.('content-type') as string | undefined;

                resolve({ body, contentType, etag: bodyEtag, status });
                return origEnd(body as never);
              };
            }

            next();
          });
        },
        ttl,
        { swr, tags: resolvedTags }
      );

      // Status gate: only cache 2xx successful responses
      if (typeof cached.status === 'number' && (cached.status < 200 || cached.status >= 300)) {
        await activeCache.delete(key).catch(() => {});
        return;
      }

      if (!res.headersSent) {
        if (cached.etag) {
          if (res.setHeader) res.setHeader('ETag', cached.etag);
          if (ifNoneMatch === cached.etag) {
            return res.status(304).end();
          }
        }

        if (cached.contentType && res.setHeader) {
          res.setHeader('Content-Type', cached.contentType);
        }

        if (cached.status && res.status) {
          res.status(cached.status);
        }

        if (typeof cached.body === 'object' && cached.body !== null && res.json) {
          return res.json(cached.body);
        } else if (res.send) {
          return res.send(cached.body);
        } else if (res.end) {
          return res.end(cached.body);
        }
      }
    } catch (err) {
      next(err);
    }
  };
}

/** Alias matching legacy nomenclature */
export const expressCache = createExpressMiddleware;
