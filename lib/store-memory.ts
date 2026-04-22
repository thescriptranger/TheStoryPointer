import type { SessionStore } from './store.js';
import type { Session } from './types.js';

/**
 * In-process Map. Good for local dev and unit tests.
 * Useless on Vercel serverless — each function instance is independent.
 */
export class MemoryStore implements SessionStore {
  readonly kind = 'memory' as const;
  private map = new Map<string, Session>();

  async create(session: Session): Promise<boolean> {
    const key = session.code.toUpperCase();
    if (this.map.has(key)) return false;
    this.map.set(key, session);
    return true;
  }

  async get(code: string): Promise<Session | null> {
    return this.map.get(code.toUpperCase()) ?? null;
  }

  async save(session: Session): Promise<void> {
    this.map.set(session.code.toUpperCase(), session);
  }

  async delete(code: string): Promise<void> {
    this.map.delete(code.toUpperCase());
  }
}
