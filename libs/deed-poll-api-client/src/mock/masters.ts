import { randomUUID } from "node:crypto";
import { MASTER_LIMITS, type WireMaster } from "../api/wire.js";

const CREATE_KEYS = new Set(["name", "email", "available"]);
const UPDATE_KEYS = new Set(["name", "email", "available", "revision"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUPLICATE_EMAIL = "Another Master already has this email address.";
const UNKNOWN_KEY = "Only name, email, available and, on a change, revision may be supplied.";
const NAME_MESSAGE = `Enter the Master's name, at most ${MASTER_LIMITS.maxNameLength} characters.`;
const EMAIL_MESSAGE = "Enter the Master's email address, like name@example.com.";
const AVAILABLE_MESSAGE = "Say whether the Master is available, as true or false.";
const LINKED_ELSEWHERE = "A judicial caller's email matches a Master already linked to another account";
const ALREADY_LINKED = "A judicial caller already linked to one Master has the email of another";

/**
 * api's Masters list (`MasterService`), restated in its words and its checking order: names trimmed, emails trimmed
 * and lower-cased so a duplicate is one in any case, a keyed patch at a revision whose stale check comes before the
 * no-op, and no delete. A changed email unlinks the entry. The linked IDAM subject is held here and never published,
 * as api's column is not, and a refusal never echoes the address.
 *
 * The referrals are the server's, so the referral side of linking and unlinking (plan D2) is its two callbacks:
 * `linked` runs only when a link was written, as api's `attachToLinkedMaster` and `attachLegacyClaims` do, and
 * `unlinked` when an email change cut a linked Master off, as `detachFromUnlinkedMaster` does.
 */
export function createMasters(referrals: ReferralSide = { linked: () => {}, unlinked: () => {} }) {
  const masters = new Map<string, MockMaster>();

  return {
    reset() {
      masters.clear();
    },
    list(): WireMaster[] {
      return [...masters.values()].sort(byNameThenId).map(toWire);
    },
    create(body: unknown): Reply {
      const fields = asObject(body);
      const unknownKey = Object.keys(fields).find((key) => !CREATE_KEYS.has(key));
      if (unknownKey) return invalid(unknownKey, UNKNOWN_KEY);
      const name = readName(fields.name);
      if (name === null) return invalid("name", NAME_MESSAGE);
      const email = readEmail(fields.email);
      if (email === null) return invalid("email", EMAIL_MESSAGE);
      if (fields.available !== undefined && typeof fields.available !== "boolean") return invalid("available", AVAILABLE_MESSAGE);
      if (holder(email) !== undefined) return duplicateEmail();

      const master: MockMaster = { id: randomUUID(), name, email, available: fields.available ?? true, revision: 0, subject: null };
      masters.set(master.id, master);
      return { status: 201, body: toWire(master) };
    },
    update(id: string, body: unknown): Reply {
      const fields = asObject(body);
      const unknownKey = Object.keys(fields).find((key) => !UPDATE_KEYS.has(key));
      if (unknownKey) return invalid(unknownKey, UNKNOWN_KEY);
      if (!("name" in fields) && !("email" in fields) && !("available" in fields)) {
        return invalid("name", "Supply at least one of name, email and available.");
      }
      const name = "name" in fields ? readName(fields.name) : undefined;
      if (name === null) return invalid("name", NAME_MESSAGE);
      const email = "email" in fields ? readEmail(fields.email) : undefined;
      if (email === null) return invalid("email", EMAIL_MESSAGE);
      if ("available" in fields && typeof fields.available !== "boolean") return invalid("available", AVAILABLE_MESSAGE);
      const revision = fields.revision;
      if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return invalid("revision", "Reload the Masters list before saving.");

      // api parses the id as a UUID, so anything else is the same 404 as an unknown one.
      const master = UUID.test(id) ? masters.get(id.toLowerCase()) : undefined;
      if (!master) return { status: 404, body: { error: "No such Master" } };
      // Before the no-op, so an out-of-date form holding the values the row now has is never told it saved.
      if (revision !== master.revision) return conflict("This Master has changed. Reload the Masters list before saving.");

      const next = {
        name: name ?? master.name,
        email: email ?? master.email,
        available: (fields.available as boolean | undefined) ?? master.available
      };
      const emailChanged = next.email !== master.email;
      if (next.name === master.name && !emailChanged && next.available === master.available) {
        return { status: 200, body: toWire(master) };
      }
      const other = emailChanged ? holder(next.email) : undefined;
      if (other !== undefined && other.id !== master.id) return duplicateEmail();

      const updated: MockMaster = { ...master, ...next, revision: master.revision + 1, subject: emailChanged ? null : master.subject };
      masters.set(master.id, updated);
      if (emailChanged && master.subject !== null) referrals.unlinked(master.id);
      return { status: 200, body: toWire(updated) };
    },
    /**
     * api's `linkIfListed`, run once per judicial request: links the caller to the unlinked entry holding their
     * IDAM email. It never creates or moves an entry, and the two cases it leaves alone warn in api's fixed
     * sentences, which name neither the address nor the subject.
     */
    linkIfListed(caller: { isJudicial: boolean; subject: string | null; email: string | null }): void {
      if (!caller.isJudicial || caller.subject === null || caller.email === null) return;
      const entry = holder(caller.email);
      if (entry === undefined || entry.subject === caller.subject) return;
      if (entry.subject !== null) {
        console.warn(LINKED_ELSEWHERE);
        return;
      }
      if ([...masters.values()].some((master) => master.subject === caller.subject)) {
        console.warn(ALREADY_LINKED);
        return;
      }
      masters.set(entry.id, { ...entry, subject: caller.subject });
      referrals.linked(entry.id, caller.subject);
    },
    /**
     * The Master a referral may be assigned to, or undefined for an id api would not find (not a UUID, or unknown).
     * The subject is for the server to store on the referral and never to publish.
     */
    assignee(id: string): { id: string; name: string; available: boolean; subject: string | null } | undefined {
      const master = UUID.test(id) ? masters.get(id.toLowerCase()) : undefined;
      return master && { id: master.id, name: master.name, available: master.available, subject: master.subject };
    }
  };

  function holder(email: string): MockMaster | undefined {
    return [...masters.values()].find((master) => master.email === email);
  }
}

function asObject(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function readName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= MASTER_LIMITS.maxNameLength ? name : null;
}

// Exactly one `@` and no whitespace once trimmed, as api's `MasterEmail` checks; lower-cased so case cannot
// make a second Master of one address.
function readEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MASTER_LIMITS.maxEmailLength || /\s/.test(email)) return null;
  const at = email.indexOf("@");
  return at > 0 && at === email.lastIndexOf("@") && at < email.length - 1 ? email : null;
}

function byNameThenId(left: MockMaster, right: MockMaster): number {
  return left.name.localeCompare(right.name) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function toWire(master: MockMaster): WireMaster {
  return { id: master.id, name: master.name, email: master.email, available: master.available, linked: master.subject !== null, revision: master.revision };
}

function invalid(field: string, message: string): Reply {
  return { status: 400, body: { error: message, errors: [{ field, message }] } };
}

function conflict(error: string): Reply {
  return { status: 409, body: { error } };
}

function duplicateEmail(): Reply {
  return { status: 409, body: { error: DUPLICATE_EMAIL, errors: [{ field: "email", message: DUPLICATE_EMAIL }] } };
}

interface MockMaster {
  id: string;
  name: string;
  email: string;
  available: boolean;
  revision: number;
  /** The linked IDAM subject, or null until the Master signs in. Never published. */
  subject: string | null;
}

interface ReferralSide {
  linked(masterId: string, subject: string): void;
  unlinked(masterId: string): void;
}

interface Reply {
  status: number;
  body: unknown;
}
