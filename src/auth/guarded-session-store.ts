/**
 * The session store, guarded so that a session once destroyed stays destroyed whatever is still running.
 *
 * `connect-redis` writes with an unconditional `SET`, so any request still holding a loaded session could put it back
 * after logout: a refresh waiting on IDAM, an activity save, or `express-session`'s own end-of-response save. Review
 * finding E01 reproduced exactly that. Here every write is a Lua script, which Redis runs atomically, and the only
 * write that can bring a key into existence is the one for a session this process generated and has never stored.
 *
 * Each record is a hash: `inc`, a random incarnation minted at creation; `rev`, a counter every write increments; and
 * `sess`, the session as JSON. A loaded session carries the `inc` and `rev` it was read at in a `WeakMap` keyed on the
 * session object itself, so `express-session`'s automatic saves carry them too without being told, and nothing the
 * browser sends is consulted — the cookie only says which key to read. A write is refused when the key has gone
 * (revoked or expired), when its incarnation is another one, or when another write has moved `rev` on: a refused
 * write changes nothing and fails its callback with `SessionWriteRefusedError`. Never a fallback to a plain write.
 *
 * Destruction is a plain `DEL` and always wins: after it, no snapshot can satisfy the update script. There is no
 * tombstone because none is needed — a missing key is refused for an update, and only a session that was never
 * stored may be created, under an id `express-session` has just generated. Rev and data share one key and one TTL,
 * so no metadata can outlive, or expire before, the session it describes.
 *
 * The keyspace is not `connect-redis`'s. See `SESSION_KEY_PREFIX` in `src/app.ts` for why the prefix changed with
 * this store, and the plan `docs/plans/20261020-e01-session-revocation.md` for the rollout rule that follows.
 */
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { type SessionData, Store } from "express-session";

const READ = "return redis.call('HMGET', KEYS[1], 'inc', 'rev', 'sess')";
const CREATE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'inc', ARGV[1], 'rev', '1', 'sess', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1`;
const UPDATE = `
local current = redis.call('HMGET', KEYS[1], 'inc', 'rev')
if not current[1] then return -1 end
if current[1] ~= ARGV[1] or current[2] ~= ARGV[2] then return -2 end
local rev = redis.call('HINCRBY', KEYS[1], 'rev', 1)
redis.call('HSET', KEYS[1], 'sess', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return rev`;
// Only the incarnation is checked, since a touch changes no data, but it must not extend a different session's key.
const TOUCH = `
if redis.call('HGET', KEYS[1], 'inc') ~= ARGV[1] then return 0 end
return redis.call('EXPIRE', KEYS[1], ARGV[2])`;
const DESTROY = "return redis.call('DEL', KEYS[1])";

const REVISION = /^[1-9]\d*$/;

export class GuardedSessionStore extends Store {
  readonly #client: SessionRedis;
  readonly #prefix: string;
  readonly #ttl: (sess: SessionData) => number;
  /** Read results awaiting `createSession`, and the sessions it built from them, each with the version it was read at. */
  readonly #versions = new WeakMap<object, RecordVersion>();

  constructor(options: GuardedSessionStoreOptions) {
    super();
    this.#client = options.client;
    this.#prefix = options.prefix;
    this.#ttl = options.ttl;
  }

  override get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    this.#run(READ, sid, [])
      .then((reply) => {
        const [inc, rev, body] = (reply ?? []) as (string | null)[];
        if (!inc && !rev && !body) return callback(null, null);
        const sess = parseRecord(inc, rev, body);
        // Unreadable is treated as absent, so the request is anonymous rather than signed in on a guess.
        if (!sess) {
          console.warn("session record unreadable: treated as signed out");
          return callback(null, null);
        }
        this.#versions.set(sess, { inc: inc as string, rev: rev as string });
        callback(null, sess);
      })
      .catch((error: unknown) => callback(error));
  }

  /** `express-session` builds `req.session` from what `get` returned; the version moves with it. */
  override createSession(req: Request, sess: SessionData) {
    const version = this.#versions.get(sess);
    const session = super.createSession(req, sess);
    if (version) this.#versions.set(session, version);
    return session;
  }

  override set(sid: string, sess: SessionData, callback: (err?: unknown) => void = () => {}): void {
    const ttl = Math.ceil(this.#ttl(sess));
    if (!(ttl > 0)) {
      this.destroy(sid, callback);
      return;
    }
    const body = JSON.stringify(sess);
    const version = this.#versions.get(sess);

    const write = version ? this.#update(sid, sess, version, body, ttl) : this.#create(sid, sess, body, ttl);
    write.then(() => callback(), callback);
  }

  override touch(sid: string, sess: SessionData, callback: () => void = () => {}): void {
    const version = this.#versions.get(sess);
    if (!version) {
      callback();
      return;
    }
    const ttl = Math.ceil(this.#ttl(sess));
    // `express-session` declares this callback without an error, but it forwards one if given, and a failed touch
    // must reach its error handling rather than vanish.
    const done = callback as (err?: unknown) => void;
    this.#run(TOUCH, sid, [version.inc, String(Math.max(1, ttl))]).then(() => done(), done);
  }

  override destroy(sid: string, callback: (err?: unknown) => void = () => {}): void {
    this.#run(DESTROY, sid, []).then(() => callback(), callback);
  }

  async #create(sid: string, sess: SessionData, body: string, ttl: number): Promise<void> {
    const inc = randomUUID();
    const created = await this.#run(CREATE, sid, [inc, body, String(ttl)]);
    if (created !== 1) throw new SessionWriteRefusedError("exists");
    this.#versions.set(sess, { inc, rev: "1" });
  }

  async #update(sid: string, sess: SessionData, version: RecordVersion, body: string, ttl: number): Promise<void> {
    const rev = await this.#run(UPDATE, sid, [version.inc, version.rev, body, String(ttl)]);
    if (rev === -1) throw new SessionWriteRefusedError("missing");
    if (typeof rev !== "number" || rev < 1) throw new SessionWriteRefusedError("conflict");
    this.#versions.set(sess, { inc: version.inc, rev: String(rev) });
  }

  #run(script: string, sid: string, args: string[]): Promise<unknown> {
    return this.#client.eval(script, { keys: [this.#prefix + sid], arguments: args });
  }
}

/**
 * A write the store refused because the session it was based on is no longer the one stored. Its message names the
 * reason and never the session id.
 */
export class SessionWriteRefusedError extends Error {
  readonly reason: SessionWriteRefusal;

  constructor(reason: SessionWriteRefusal) {
    super(`session write refused: ${reason}`);
    this.name = "SessionWriteRefusedError";
    this.reason = reason;
  }
}

function parseRecord(inc: string | null, rev: string | null, body: string | null): SessionData | undefined {
  if (!inc || !rev || !body || !REVISION.test(rev)) return undefined;
  try {
    const sess: unknown = JSON.parse(body);
    return sess !== null && typeof sess === "object" && "cookie" in sess ? (sess as SessionData) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `missing`: the key is gone — destroyed, regenerated away or expired. `conflict`: another write, or another
 * incarnation, got there first. `exists`: a new session's id was already taken, which a generated id never should be.
 */
export type SessionWriteRefusal = "missing" | "conflict" | "exists";

interface RecordVersion {
  inc: string;
  rev: string;
}

/** The one command this store needs, so any node-redis client shape satisfies it. */
export interface SessionRedis {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export interface GuardedSessionStoreOptions {
  client: SessionRedis;
  prefix: string;
  /** Seconds the key lives from each write, as `sessionStoreTtl` computes. */
  ttl: (sess: SessionData) => number;
}
