import { randomUUID } from "node:crypto";
import { MASTER_LIMITS, type WireMaster } from "../api/wire.js";

const CREATE_KEYS = new Set(["name", "email", "available"]);
const UPDATE_KEYS = new Set(["name", "email", "available", "revision"]);
const DUPLICATE_EMAIL = "Another Master already has that email address.";

/**
 * api's Masters list (`MasterService`), restated: names trimmed, emails trimmed and lower-cased so a duplicate is
 * one in any case, a keyed patch at a revision, and no delete. The linked IDAM subject is held here and never
 * published, as api's column is not.
 */
export function createMasters() {
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
      if (unknownKey) return invalid(unknownKey, `${unknownKey} cannot be supplied.`);
      const name = readName(fields.name);
      if (name === null) return invalid("name", nameMessage());
      const email = readEmail(fields.email);
      if (email === null) return invalid("email", emailMessage());
      if (fields.available !== undefined && typeof fields.available !== "boolean") return invalid("available", "available must be true or false.");
      if (holder(email) !== undefined) return conflict(DUPLICATE_EMAIL);

      const master: MockMaster = { id: randomUUID(), name, email, available: fields.available ?? true, revision: 0, subject: null };
      masters.set(master.id, master);
      return { status: 201, body: toWire(master) };
    },
    update(id: string, body: unknown): Reply {
      const fields = asObject(body);
      const unknownKey = Object.keys(fields).find((key) => !UPDATE_KEYS.has(key));
      if (unknownKey) return invalid(unknownKey, `${unknownKey} cannot be supplied.`);
      if (fields.name === undefined && fields.email === undefined && fields.available === undefined) {
        return invalid("name", "Supply a name, an email or availability to change.");
      }
      const name = fields.name === undefined ? undefined : readName(fields.name);
      if (name === null) return invalid("name", nameMessage());
      const email = fields.email === undefined ? undefined : readEmail(fields.email);
      if (email === null) return invalid("email", emailMessage());
      if (fields.available !== undefined && typeof fields.available !== "boolean") return invalid("available", "available must be true or false.");
      const revision = fields.revision;
      if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return invalid("revision", "Reload the Masters list before saving.");

      const master = masters.get(id);
      if (!master) return { status: 404, body: { error: "Master not found" } };
      if (revision !== master.revision) return conflict("This Master has changed. Reload the Masters list before saving.");
      const other = email === undefined ? undefined : holder(email);
      if (other !== undefined && other.id !== master.id) return conflict(DUPLICATE_EMAIL);

      const next: MockMaster = {
        ...master,
        name: name ?? master.name,
        email: email ?? master.email,
        available: (fields.available as boolean | undefined) ?? master.available
      };
      if (next.name === master.name && next.email === master.email && next.available === master.available) {
        return { status: 200, body: toWire(master) };
      }
      const updated = { ...next, revision: master.revision + 1, subject: next.email === master.email ? master.subject : null };
      masters.set(id, updated);
      return { status: 200, body: toWire(updated) };
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

function nameMessage(): string {
  return `Enter a name of 1 to ${MASTER_LIMITS.maxNameLength} characters.`;
}

function emailMessage(): string {
  return "Enter an email address with exactly one @ and no spaces.";
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

interface MockMaster {
  id: string;
  name: string;
  email: string;
  available: boolean;
  revision: number;
  /** The linked IDAM subject, or null until the Master signs in. Never published. */
  subject: string | null;
}

interface Reply {
  status: number;
  body: unknown;
}
