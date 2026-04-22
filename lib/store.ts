import type { Session } from './types.js';
import { MemoryStore } from './store-memory.js';
import { RedisStore } from './store-redis.js';

export interface SessionStore {
  readonly kind: 'memory' | 'redis';
  create(session: Session): Promise<boolean>;
  get(code: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(code: string): Promise<void>;
}

let _instance: SessionStore | null = null;

export function getStore(): SessionStore {
  if (_instance) return _instance;

  // Vercel Marketplace's Upstash integration exports these.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.REDIS_REST_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.REDIS_REST_TOKEN;

  if (url && token) {
    _instance = new RedisStore(url, token);
  } else {
    _instance = new MemoryStore();
  }
  return _instance;
}

/** For tests: swap in a specific store. */
export function setStore(store: SessionStore): void {
  _instance = store;
}
