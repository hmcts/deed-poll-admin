import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { WIRE_SCHEMAS, type WireGazetteError, type WireGazetteStatus } from "../api/wire.js";
import type { MockCase } from "./server.js";

const MEMBER = WIRE_SCHEMAS.GazetteMemberResponse;
const SEEDED_REQUEST = z.object({ status: WIRE_SCHEMAS.GazetteStatusResponse, cases: z.array(MEMBER) }).strict();

/** UI contract fixture, not a second delivery engine: no files, provider calls, leases or timers. */
export function createGazetteRequests() {
  const requests = new Map<string, RequestRecord>();
  const previews = new Map<string, { ids: string[]; snapshot: string; expires: number }>();
  let outcome: WireGazetteStatus["state"] = "Sent";
  let loseResponse = false;

  return {
    reset() {
      requests.clear();
      previews.clear();
      outcome = "Sent";
      loseResponse = false;
    },
    seed(body: unknown): Reply {
      const parsed = SEEDED_REQUEST.safeParse(body);
      if (!parsed.success) return invalid();
      if (requests.has(parsed.data.status.batchId)) return { status: 409, body: { error: "Batch already exists" } };
      requests.set(parsed.data.status.batchId, { ...parsed.data, key: null, subject: null, identity: null });
      return { status: 201, body: parsed.data.status };
    },
    configure(body: unknown): Reply {
      const parsed = z.object({ state: WIRE_SCHEMAS.GazetteStatusResponse.shape.state, loseResponse: z.boolean().optional() }).strict().safeParse(body);
      if (!parsed.success) return invalid();
      outcome = parsed.data.state;
      loseResponse = parsed.data.loseResponse ?? false;
      return { status: 200, body: { state: outcome } };
    },
    handle({ method, path, query, body, key, subject, name }: GazetteRequest, context: GazetteContext): Reply {
      if (path === "/caseworker/gazette-notice-previews" && method === "POST") {
        return previewRequest(body, context);
      }
      if (path === "/caseworker/gazette-notices" && method === "POST") {
        return submitRequest(body, key, subject, name, context);
      }
      if (path === "/caseworker/gazette-notice-requests" && method === "GET") {
        return listRequests(query);
      }
      const match = /^\/caseworker\/gazette-notices\/([^/]+)(\/cases)?$/.exec(path);
      if (match && method === "GET") {
        return readRequest(decodeURIComponent(match[1]), Boolean(match[2]), query, context.batches);
      }
      return { status: 405, body: { error: "Method not allowed" } };
    }
  };

  function previewRequest(body: unknown, { cases, settings, batches }: GazetteContext): Reply {
    const parsed = WIRE_SCHEMAS.PreviewGazetteRequest.safeParse(body);
    if (!parsed.success) return invalid();
    const members = select(parsed.data.caseIds, cases, settings, requests, batches);
    if (!Array.isArray(members)) return members;
    const fingerprint = randomUUID();
    const expires = Date.now() + 30 * 60_000;
    previews.set(fingerprint, { ids: [...parsed.data.caseIds].sort(compare), snapshot: snapshot(members), expires });
    return {
      status: 200,
      body: {
        recipientEmail: settings.recipientEmail,
        recipientRevision: settings.revision,
        ...counts(members),
        cases: membership(members),
        selectionFingerprint: fingerprint,
        expiresAt: new Date(expires)
      }
    };
  }

  function submitRequest(body: unknown, key: unknown, subject: string, name: string, context: GazetteContext): Reply {
    const parsed = WIRE_SCHEMAS.SubmitGazetteRequest.safeParse(body);
    if (!parsed.success || !z.uuid().safeParse(key).success) return invalid();
    const input = parsed.data;
    const identity = JSON.stringify({ ...input, caseIds: [...input.caseIds].sort(compare) });
    const existing = [...requests.values()].find((request) => request.key === key);
    // An admitted key is resolved before today's settings, readiness and confirmation checks.
    if (existing) {
      return existing.identity === identity && existing.subject === subject ? statusReply(existing.status) : refused("REQUEST_KEY_REUSED");
    }
    const members = confirmSelection(input, context);
    if (!Array.isArray(members)) return members;
    return admit(members, key, subject, name, identity, context);
  }

  function confirmSelection(input: z.infer<typeof WIRE_SCHEMAS.SubmitGazetteRequest>, { cases, settings, batches }: GazetteContext): MockCase[] | Reply {
    if (input.recipientRevision !== settings.revision) return refused("RECIPIENT_CHANGED");
    const members = select(input.caseIds, cases, settings, requests, batches);
    if (!Array.isArray(members)) return members;
    const preview = previews.get(input.selectionFingerprint);
    if (!preview) return invalid();
    if (preview.expires <= Date.now()) return refused("CONFIRMATION_EXPIRED");
    if (preview.snapshot !== snapshot(members) || JSON.stringify(preview.ids) !== JSON.stringify([...input.caseIds].sort(compare))) {
      return refused("SELECTION_CHANGED");
    }
    return members;
  }

  function admit(members: MockCase[], key: unknown, subject: string, name: string, identity: string, { settings, batches }: GazetteContext): Reply {
    const now = new Date();
    const batchId = randomUUID();
    const status: WireGazetteStatus = {
      batchId,
      state: outcome,
      submittedAt: now,
      submittedBy: name,
      recipientEmail: settings.recipientEmail,
      recipientRevision: settings.revision,
      ...counts(members),
      sentAt: outcome === "Sent" ? now : null,
      failureCode: outcome === "NotSent" ? "PROVIDER_REFUSED" : outcome === "Uncertain" ? "SEND_OUTCOME_UNKNOWN" : null
    };
    requests.set(batchId, { status, cases: membership(members), key: String(key), subject, identity });
    if (outcome === "Sent") {
      for (const member of members) member.dateNoticeSentToLondonGazette = now;
      batches.set(batchId, { id: batchId, sentAt: now, sentBy: name, referenceNumbers: membership(members).map((m) => m.referenceNumber) });
    }
    return { ...statusReply(status), loseResponse };
  }

  function listRequests(query: URLSearchParams): Reply {
    const state = query.get("state");
    if (state !== null && !WIRE_SCHEMAS.GazetteStatusResponse.shape.state.safeParse(state).success) return invalid();
    const values = [...requests.values()]
      .map((request) => request.status)
      .filter((row) => state === null || row.state === state)
      .sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0) || compare(b.batchId, a.batchId));
    return page(values, query, "requests");
  }

  function readRequest(id: string, wantsCases: boolean, query: URLSearchParams, batches: Map<string, LegacyBatch>): Reply {
    if (!z.uuid().safeParse(id).success) return invalid();
    const request = requests.get(id);
    const legacy = batches.get(id);
    if (!request && !legacy) return { status: 404, body: { error: "Gazette request not found" } };
    if (wantsCases) {
      const members =
        request?.cases ??
        legacy?.referenceNumbers.map((referenceNumber, index) => ({
          // Legacy seed fixtures predate member IDs. These synthetic IDs belong to the fixture only.
          caseId: `legacy-${id}-${index}`,
          referenceNumber
        })) ??
        [];
      return page(
        [...members].sort((a, b) => compare(a.referenceNumber, b.referenceNumber) || compare(a.caseId, b.caseId)),
        query,
        "cases"
      );
    }
    return {
      status: 200,
      body: request?.status ?? {
        batchId: id,
        state: "Sent",
        caseCount: legacy?.referenceNumbers.length,
        sentAt: legacy?.sentAt,
        submittedAt: null,
        submittedBy: null,
        recipientEmail: null,
        recipientRevision: null,
        adultCount: null,
        minorCount: null,
        failureCode: null
      }
    };
  }
}

function select(
  ids: string[],
  cases: Map<string, MockCase>,
  settings: Settings,
  requests: Map<string, RequestRecord>,
  batches: Map<string, LegacyBatch>
): MockCase[] | Reply {
  if (!settings.recipientEmail) return refused("RECIPIENT_NOT_CONFIGURED");
  const selected: MockCase[] = [];
  for (const id of ids) {
    const row = cases.get(id);
    if (!row) return refused("CASE_NOT_READY", [{ caseId: id, reason: "NOT_FOUND" }]);
    if (!row.type || !["Adult", "AdultTransgender", "Minor", "MinorTransgender"].includes(row.type)) {
      return refused("CASE_TYPE_UNSUPPORTED", [{ caseId: id, reason: "TYPE_UNSUPPORTED" }]);
    }
    if (
      [...requests.values()].some((request) => request.status.state !== "NotSent" && request.cases.some((member) => member.caseId === id)) ||
      [...batches.values()].some((batch) => batch.referenceNumbers.includes(row.displayReference ?? ""))
    ) {
      return refused("CASE_RESERVED", [{ caseId: id, reason: "RESERVED" }]);
    }
    if (row.state !== "Enroled" || !row.publishToLondonGazette || row.dateNoticeSentToLondonGazette) return refused("CASE_NOT_READY");
    if (!row.displayReference) return refused("CASE_NOT_READY", [{ caseId: id, reason: "REFERENCE_MISSING" }]);
    selected.push(row);
  }
  return selected.sort((a, b) => (a.dateEnroled?.getTime() ?? Infinity) - (b.dateEnroled?.getTime() ?? Infinity) || compare(a.id, b.id));
}

function counts(members: MockCase[]) {
  const adultCount = members.filter((row) => row.type === "Adult" || row.type === "AdultTransgender").length;
  return { adultCount, minorCount: members.length - adultCount, caseCount: members.length };
}

function membership(members: MockCase[]) {
  return members.map((row) => ({ caseId: row.id, referenceNumber: row.displayReference ?? "" }));
}

function snapshot(members: MockCase[]) {
  // Conservative mock comparison. Production fingerprints only mapped cells and readiness under database locks.
  return createHash("sha256")
    .update(JSON.stringify([...members].sort((a, b) => compare(a.id, b.id))))
    .digest("hex");
}

function compare(a: string, b: string) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}
function invalid(): Reply {
  return { status: 400, body: { error: "Invalid Gazette request" } };
}
function refused(code: WireGazetteError["code"], conflicts: WireGazetteError["conflicts"] = []): Reply {
  return { status: code === "GAZETTE_UNAVAILABLE" ? 503 : 409, body: { code, conflicts, error: "Gazette request refused" } };
}
function statusReply(status: WireGazetteStatus): Reply {
  return { status: status.state === "Preparing" || status.state === "Sending" ? 202 : 200, body: status };
}
function page<T>(rows: T[], query: URLSearchParams, key: string): Reply {
  const pageText = query.get("page") ?? "1";
  const sizeText = query.get("size") ?? "25";
  if (!/^[1-9]\d*$/.test(pageText) || !/^[1-9]\d*$/.test(sizeText)) return invalid();
  const number = Number(pageText);
  const size = Math.min(Number(sizeText), 100);
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(Number(sizeText))) return invalid();
  return {
    status: 200,
    body: { [key]: rows.slice((number - 1) * size, number * size), page: number, size, total: rows.length, totalPages: Math.ceil(rows.length / size) }
  };
}

interface GazetteRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  key: unknown;
  subject: string;
  name: string;
}
interface GazetteContext {
  cases: Map<string, MockCase>;
  settings: Settings;
  batches: Map<string, LegacyBatch>;
}
interface Reply {
  status: number;
  body: unknown;
  loseResponse?: boolean;
}
interface Settings {
  recipientEmail?: string | null;
  revision: number;
}
interface LegacyBatch {
  id?: string;
  sentAt: Date;
  sentBy: string;
  referenceNumbers: string[];
}
interface RequestRecord {
  status: WireGazetteStatus;
  cases: z.infer<typeof MEMBER>[];
  key: string | null;
  subject: string | null;
  identity: string | null;
}
