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

export function findMasterChoices(caller: Caller): Promise<MasterList> {
  return callApi(caller, (config) => listMasters(config));
}

/**
 * The radios' data: the available Masters in api's order, which one is chosen, and the window their counts are for.
 *
 * `selectedId` is whatever was posted or stored, so it is compared rather than trusted: a value that matches no
 * Master checks nothing.
 */
export function buildMasterChoices(list: MasterList, selectedId: unknown): MasterChoices {
  // Since api F1 the Masters list carries no window, cap or count, so nobody reads as full here. Plan Fa1's Task 1
  // removes the raise form's and the assign page's Master radios, and this module with them.
  return {
    window: null,
    choices: list.masters.flatMap((master) => {
      const name = master.name?.trim();
      return master.available && name ? [{ id: master.id, name, held: 0, cap: 0, isFull: false, isChecked: master.id === selectedId }] : [];
    })
  };
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
