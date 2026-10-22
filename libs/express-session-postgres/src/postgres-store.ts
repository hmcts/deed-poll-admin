import { callbackify } from "node:util";
import type { SessionData } from "express-session";
import { Store } from "express-session";
import type { Pool } from "pg";
import format from "pg-format";

export class PostgresStore extends Store {
  private pool: Pool;
  private tableName: string;
  private schemaName: string;
  private ttl: number;
  private disableTouch: boolean;
  private cleanupInterval: number;
  private cleanupTimer?: NodeJS.Timeout;

  private constructor(options: PostgresStoreOptions) {
    super();

    if (!options.pool) {
      throw new Error("PostgreSQL connection pool is required");
    }

    this.pool = options.pool;
    this.tableName = options.tableName || "session";
    this.schemaName = options.schemaName || "public";
    this.ttl = options.ttl || 86400;
    this.disableTouch = options.disableTouch || false;
    this.cleanupInterval = options.cleanupInterval ?? 900000; // 15 minutes default
  }

  static async create(options: PostgresStoreOptions): Promise<PostgresStore> {
    const store = new PostgresStore(options);
    await store.initTable();
    if (store.cleanupInterval > 0) {
      store.startCleanup();
    }
    return store;
  }

  private async initTable(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const createTableQuery = format(
        "CREATE TABLE IF NOT EXISTS %I.%I (sid VARCHAR(255) PRIMARY KEY, sess JSONB NOT NULL, expire TIMESTAMPTZ NOT NULL)",
        this.schemaName,
        this.tableName
      );
      await client.query(createTableQuery);

      const createIndexQuery = format("CREATE INDEX IF NOT EXISTS %I ON %I.%I (expire)", `idx_${this.tableName}_expire`, this.schemaName, this.tableName);
      await client.query(createIndexQuery);
    } finally {
      client.release();
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.clearExpiredSessions().catch((err) => {
        console.error("Failed to clear expired sessions:", err);
      });
    }, this.cleanupInterval);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private async clearExpiredSessions(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const query = format("DELETE FROM %I.%I WHERE expire < NOW()", this.schemaName, this.tableName);
      await client.query(query);
    } finally {
      client.release();
    }
  }

  private getExpireDate(session: SessionData): Date {
    let ttl = this.ttl;
    if (session.cookie?.maxAge) {
      ttl = Math.floor(session.cookie.maxAge / 1000);
    }
    return new Date(Date.now() + ttl * 1000);
  }

  get(sid: string, callback: (err: any, session?: SessionData | null) => void): void {
    callbackify(async (): Promise<SessionData | null> => {
      const client = await this.pool.connect();
      try {
        const query = format("SELECT sess FROM %I.%I WHERE sid = $1 AND expire > NOW()", this.schemaName, this.tableName);
        const result = await client.query(query, [sid]);

        if (result.rows.length === 0) {
          return null;
        }

        return result.rows[0].sess;
      } finally {
        client.release();
      }
    })(callback);
  }

  async set(sid: string, session: SessionData, callback?: (err?: any) => void): Promise<void> {
    const client = await this.pool.connect();
    try {
      const expire = this.getExpireDate(session);

      const query = format(
        "INSERT INTO %I.%I (sid, sess, expire) VALUES ($1, $2, $3) ON CONFLICT (sid) DO UPDATE SET sess = $2, expire = $3",
        this.schemaName,
        this.tableName
      );
      await client.query(query, [sid, JSON.stringify(session), expire]);

      callback?.(null);
    } catch (error) {
      callback?.(error);
    } finally {
      client.release();
    }
  }

  async destroy(sid: string, callback?: (err?: any) => void): Promise<void> {
    const client = await this.pool.connect();
    try {
      const query = format("DELETE FROM %I.%I WHERE sid = $1", this.schemaName, this.tableName);
      await client.query(query, [sid]);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    } finally {
      client.release();
    }
  }

  touch(sid: string, session: SessionData, callback?: (err?: any) => void): void {
    if (this.disableTouch) {
      callback?.(null);
      return;
    }

    // Deliver completion outside the database operation so a consumer's throw is not retried as a store error.
    callbackify(async () => {
      const client = await this.pool.connect();
      try {
        const expire = this.getExpireDate(session);
        const query = format("UPDATE %I.%I SET expire = $2 WHERE sid = $1", this.schemaName, this.tableName);
        await client.query(query, [sid, expire]);
      } finally {
        client.release();
      }
    })((error) => callback?.(error));
  }

  async clear(callback?: (err?: any) => void): Promise<void> {
    const client = await this.pool.connect();
    try {
      const query = format("DELETE FROM %I.%I", this.schemaName, this.tableName);
      await client.query(query);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    } finally {
      client.release();
    }
  }

  async length(callback: (err: any, length?: number) => void): Promise<void> {
    const client = await this.pool.connect();
    try {
      const query = format("SELECT COUNT(*) FROM %I.%I", this.schemaName, this.tableName);
      const result = await client.query(query);
      const count = parseInt(result.rows[0].count, 10);
      callback(null, count);
    } catch (error) {
      callback(error);
    } finally {
      client.release();
    }
  }

  async all(callback: (err: any, sessions?: SessionData[] | { [sid: string]: SessionData } | null) => void): Promise<void> {
    const client = await this.pool.connect();
    try {
      const query = format("SELECT sid, sess FROM %I.%I WHERE expire > NOW()", this.schemaName, this.tableName);
      const result = await client.query(query);

      const sessions: { [sid: string]: SessionData } = {};
      for (const row of result.rows) {
        sessions[row.sid] = row.sess;
      }

      callback(null, sessions);
    } catch (error) {
      callback(error);
    } finally {
      client.release();
    }
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

interface PostgresStoreOptions {
  pool?: Pool;
  tableName?: string;
  schemaName?: string;
  cleanupInterval?: number;
  ttl?: number;
  disableTouch?: boolean;
}
