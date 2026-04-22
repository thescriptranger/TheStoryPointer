import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Tiny IncomingMessage/ServerResponse helpers. Designed so the API handlers
 * work identically under Vercel (where req.body is pre-parsed) and under our
 * local Express shim (where express.json() pre-parses).
 */

export async function readJsonBody(req: IncomingMessage): Promise<any> {
  // Vercel / Express already parsed the body — use it as-is.
  const anyReq = req as unknown as { body?: unknown };
  if (anyReq.body !== undefined && anyReq.body !== null) {
    if (typeof anyReq.body === 'string') {
      return anyReq.body.length === 0 ? {} : JSON.parse(anyReq.body);
    }
    return anyReq.body;
  }

  // Raw stream fallback.
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 32_000) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/**
 * Resolve the `[code]` path segment under both Vercel and Express.
 *   - Vercel puts it on `req.query.code`.
 *   - Express puts it on `req.params.code` via :code routing.
 *   - Fallback: parse from URL.
 */
export function getCode(req: IncomingMessage): string {
  const anyReq = req as unknown as {
    query?: Record<string, string | string[] | undefined>;
    params?: Record<string, string | undefined>;
  };
  const fromQuery = anyReq.query?.code;
  if (typeof fromQuery === 'string') return fromQuery.toUpperCase();
  if (Array.isArray(fromQuery) && fromQuery.length) return fromQuery[0].toUpperCase();
  if (anyReq.params?.code) return anyReq.params.code.toUpperCase();

  // last resort — parse from URL
  try {
    const url = new URL(req.url || '', 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    return last.toUpperCase();
  } catch {
    return '';
  }
}

export function getQueryParam(req: IncomingMessage, name: string): string | undefined {
  const anyReq = req as unknown as { query?: Record<string, string | string[] | undefined> };
  const q = anyReq.query?.[name];
  if (typeof q === 'string') return q;
  if (Array.isArray(q) && q.length) return q[0];
  try {
    const url = new URL(req.url || '', 'http://x');
    return url.searchParams.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}
