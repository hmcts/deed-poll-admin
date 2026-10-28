/**
 * The "Which Master?" radios, shared by the raise form and the assign page (plan Db1).
 *
 * The words are each page's own `en`/`cy`, passed in, because a page's copy is what the Welsh extractor reads; this
 * builds only the items. Not under `src/pages`, where every `.ts` is a route.
 *
 * **`currentMasterId` is the Master the referral already has**, on the assign page. Their radio stays enabled when
 * they are full, because the referral is already one of their count and choosing them again is api's no-op; disabling
 * it would leave the pre-selected answer unsubmittable.
 */
import type { MasterChoices } from "@hmcts/deed-poll";

export function masterRadioItems(masters: MasterChoices, words: MasterRadioWords, currentMasterId?: string): MasterRadioItem[] {
  const when = windowWords(masters.window, words);

  return masters.choices.map((choice) => ({
    value: choice.id,
    text: choice.name,
    checked: choice.isChecked,
    disabled: choice.isFull && choice.id !== currentMasterId,
    hint: {
      text: choice.isFull
        ? when === null
          ? words.masterFullUntimed
          : words.masterFull(when)
        : when === null
          ? words.masterRoomUntimed(choice.held, choice.cap)
          : words.masterRoom(choice.held, choice.cap, when)
    }
  }));
}

function windowWords(window: MasterChoices["window"], words: MasterRadioWords): string | null {
  if (window === null) return null;
  if (window.isToday) return window.slot === "AM" ? words.thisMorning : words.thisAfternoon;

  return window.slot === "AM" ? words.morningOf(window.date) : words.afternoonOf(window.date);
}

/** The hint words a page supplies from its own content. */
export interface MasterRadioWords {
  masterRoom: (held: number, cap: number, when: string) => string;
  masterFull: (when: string) => string;
  masterRoomUntimed: (held: number, cap: number) => string;
  masterFullUntimed: string;
  thisMorning: string;
  thisAfternoon: string;
  morningOf: (date: string) => string;
  afternoonOf: (date: string) => string;
}

export interface MasterRadioItem {
  value: string;
  text: string;
  checked: boolean;
  disabled: boolean;
  hint: { text: string };
}
