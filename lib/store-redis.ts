import { Redis } from '@upstash/redis';
import type { SessionStore } from './store.js';
import { type Session, SESSION_TTL_SECONDS } from './types.js';

const KEY_PREFIX = 'spp:session:';
const keyFor = (code: string) => `${KEY_PREFIX}${code.toUpperCase()}`;

/**
 * Upstash Redis-backed store. Vercel Marketplace integration injects
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN automatically.
 * TTL is refreshed on every save; sessions vanish 24h after the last touch.
 */
export class RedisStore implements SessionStore {
  readonly kind = 'redis' as const;
  private redis: Redis;

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }

  async create(session: Session): Promise<boolean> {
    // NX ensures we don't clobber an existing session with the same code.
    const result = await this.redis.set(keyFor(session.code), session, {
      ex: SESSION_TTL_SECONDS,
      nx: true,
    });
    return result === 'OK';
  }

  async get(code: string): Promise<Session | null> {
    // @upstash/redis auto-deserialises JSON.
    return (await this.redis.get<Session>(keyFor(code))) ?? null;
  }

  async save(session: Session): Promise<void> {
    await this.redis.set(keyFor(session.code), session, {
      ex: SESSION_TTL_SECONDS,
    });
  }

  async delete(code: string): Promise<void> {
    await this.redis.del(keyFor(code));
  }
}
