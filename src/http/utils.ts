import crypto from 'crypto';

export interface KeyDerivationOptions {
  /** Custom key derivation function. Overrides default URL and query string serialization. */
  keyGenerator?: (req: any) => string;
  /** Optional list of header names (case-insensitive) to include in the cache key. */
  headerWhitelist?: string[];
}

/**
 * Generates a deterministic HTTP cache key from request method, URL path, sorted query parameters,
 * and optional whitelisted headers.
 *
 * Example:
 *   GET /api/products?sort=desc&page=2
 *   GET /api/products?page=2&sort=desc
 *   Both map to: http:GET:/api/products?page=2&sort=desc
 */
export function buildDeterministicKey(req: any, options?: KeyDerivationOptions): string {
  if (options?.keyGenerator) {
    return options.keyGenerator(req);
  }

  const method = (req.method || 'GET').toUpperCase();
  const rawUrl = req.originalUrl || req.url || '/';

  const qIdx = rawUrl.indexOf('?');
  const path = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
  let queryString = '';

  if (qIdx >= 0) {
    const rawQuery = rawUrl.slice(qIdx + 1);
    try {
      const params = new URLSearchParams(rawQuery);
      params.sort();
      queryString = params.toString();
    } catch {
      queryString = rawQuery;
    }
  }

  let key = `http:${method}:${path}`;
  if (queryString) {
    key += `?${queryString}`;
  }

  if (options?.headerWhitelist && options.headerWhitelist.length > 0 && req.headers) {
    const sortedHeaders = [...options.headerWhitelist].sort();
    for (const h of sortedHeaders) {
      const normalizedHeader = h.toLowerCase();
      const val = req.headers[normalizedHeader];
      if (val !== undefined && val !== null && val !== '') {
        const headerStr = Array.isArray(val) ? val.join(',') : String(val);
        key += `|h:${normalizedHeader}=${headerStr}`;
      }
    }
  }

  return key;
}

/**
 * Checks if request specifies Cache-Control bypass directives (no-cache, no-store)
 * or matches a custom skipCache predicate.
 */
export function shouldSkipCache(req: any, customSkip?: (req: any) => boolean): boolean {
  if (customSkip && customSkip(req)) return true;

  const cc = req.headers ? (req.headers['cache-control'] || req.headers['Cache-Control']) : undefined;
  if (typeof cc === 'string') {
    const lower = cc.toLowerCase();
    if (lower.includes('no-cache') || lower.includes('no-store')) {
      return true;
    }
  }

  return false;
}

/**
 * Compute a weak ETag (W/"...") from string, Buffer, or JSON-serializable object.
 */
export function generateETag(data: unknown): string {
  const str = typeof data === 'string'
    ? data
    : Buffer.isBuffer(data)
      ? data.toString('utf8')
      : JSON.stringify(data);

  const hash = crypto.createHash('sha1').update(str).digest('hex').slice(0, 16);
  return `W/"${str.length.toString(16)}-${hash}"`;
}
