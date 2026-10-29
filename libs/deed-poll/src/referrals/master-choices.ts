/**
 * The Masters a caseworker can send a referral to, with each one's room in the current referral window (plan Db1).
 *
 * **The counts and the cap are api's, read off `GET /caseworker/masters`.** Nothing here decides whether a Master is
 * full beyond comparing api's own two numbers, and api still refuses past the cap: a Master who fills between the
 * form's read and its submit is api's 409, which the page places beside the radios. A full Master is still listed,
 * so a caseworker looking for them learns they are full rather than wondering where they went.
 *
 * **An unavailable Master is not offered.** api refuses one with a 400, and a Master who has left is not a choice.
 * Nor is a nameless one, a whitespace-only name included: api refuses a blank name on every write, but its list does
 * not promise one, and a radio with no label identifies nobody. The list keeps api's order.
 */
import { listMasters, type MasterList } from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";

// en-CA formats as `yyyy-MM-dd`, the shape api's window date has, so "today" compares as text.
const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

export function findMasterChoices(caller: Caller): Promise<MasterList> {
  return callApi(caller, (config) => listMasters(config));
}

/**
 * The radios' data: the available Masters in api's order, which one is chosen, and the window their counts are for.
 *
 * `selectedId` is whatever was posted or stored, so it is compared rather than trusted: a value that matches no
 * Master checks nothing.
 */
export function buildMasterChoices(list: MasterList, selectedId: unknown, now: Date = new Date()): MasterChoices {
  return {
    window: list.window ? { slot: list.window.slot, isToday: list.window.date === LONDON_DAY.format(now), date: shortDay(list.window.date) } : null,
    choices: list.masters.flatMap((master) => {
      const name = master.name?.trim();
      return master.available && name
        ? [
            {
              id: master.id,
              name,
              held: master.assignedInWindow,
              cap: list.cap,
              isFull: master.assignedInWindow >= list.cap,
              isChecked: master.id === selectedId
            }
          ]
        : [];
    })
  };
}

/** `dd-mm-yy` from api's `yyyy-MM-dd`, the form Steve chose for dates on these pages. */
function shortDay(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}-${month}-${year.slice(2)}`;
}

export interface MasterChoices {
  /** The window the counts are for, or `null` when api sent none. `date` is `dd-mm-yy`. */
  window: { slot: "AM" | "PM"; isToday: boolean; date: string } | null;
  choices: MasterChoice[];
}

export interface MasterChoice {
  id: string;
  name: string;
  held: number;
  cap: number;
  isFull: boolean;
  isChecked: boolean;
}
