import { DEED_POLL_STATE, DEED_POLL_TYPE, DOCUMENT_DIRECTION, MARITAL_STATUS, PRIVACY } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { DEED_POLL_STATE_LABEL, DEED_POLL_STATE_VALUE, DEED_POLL_TYPE_LABEL, DEED_POLL_TYPE_VALUE, LABELS } from "./dynamics-values.js";
import { DeedPollState, DeedPollType, DocumentDirection, MaritalStatus, Privacy } from "./option-sets.js";

describe("deed-poll/enums/option-sets", () => {
  it("maps every member of an option set to its own name", () => {
    expect(DeedPollType).toEqual({
      Adult: "Adult",
      AdultTransgender: "AdultTransgender",
      Minor: "Minor",
      MinorTransgender: "MinorTransgender",
      DeedOfRelinquishment: "DeedOfRelinquishment",
      Unknown: "Unknown"
    });
  });

  it("covers exactly the members api publishes, so a set cannot go short", () => {
    // The sets are BUILT from these arrays, so this is not a restatement of the members — it is the
    // assertion that nothing is dropped or renamed between the array and the object, which is what
    // a `Record<DeedPollType, …>` elsewhere relies on.
    expect(Object.keys(DeedPollType)).toEqual([...DEED_POLL_TYPE]);
    expect(Object.keys(DeedPollState)).toEqual([...DEED_POLL_STATE]);
    expect(Object.keys(MaritalStatus)).toEqual([...MARITAL_STATUS]);
    expect(Object.keys(Privacy)).toEqual([...PRIVACY]);
    expect(Object.keys(DocumentDirection)).toEqual([...DOCUMENT_DIRECTION]);
  });

  it("is frozen, so a member cannot be reassigned at runtime", () => {
    expect(Object.isFrozen(DeedPollState)).toBe(true);
  });

  /**
   * The Dynamics integer and label maps are keyed by the member unions, so TypeScript already
   * refuses a map that misses one. Asserted at runtime too because a widened key type — a
   * `Record<string, …>` added in haste — would silently reintroduce the gap these maps exist to
   * prevent, and a missing label renders as the raw member name on a case page.
   */
  it("has a Dynamics integer and a label for every member of every set", () => {
    expect(Object.keys(DEED_POLL_TYPE_VALUE)).toEqual([...DEED_POLL_TYPE]);
    expect(Object.keys(DEED_POLL_TYPE_LABEL)).toEqual([...DEED_POLL_TYPE]);
    expect(Object.keys(DEED_POLL_STATE_VALUE)).toEqual([...DEED_POLL_STATE]);
    expect(Object.keys(DEED_POLL_STATE_LABEL)).toEqual([...DEED_POLL_STATE]);
  });

  it("registers the type and state label sets under the keys the templates use", () => {
    expect(LABELS.type).toBe(DEED_POLL_TYPE_LABEL);
    expect(LABELS.state).toBe(DEED_POLL_STATE_LABEL);
  });
});
