/**
 * The upload form's document type as a type-ahead, because the list is now the business's thirty-two names and a
 * `<select>` of thirty-two is a scroll rather than a choice.
 *
 * **It enhances the select the server rendered, and the select is still what is submitted.** With no script the
 * page is the plain GOV.UK select it always was, and the handler, its validation and the replayed choice after a
 * refused upload are unchanged. alphagov's `enhanceSelectElement` hides the select and puts an input in its place
 * under the select's own id, so the label and the error summary's `#documentTypeId` link land on the input.
 *
 * **The select is set from the input's text on submit, not left to the widget.** The widget changes the select only
 * when an option is confirmed, so a type picked, then cleared or typed over, would still be sent — a document filed
 * under a type the caseworker could no longer see. On submit the select takes the one option whose name the input
 * holds (ignoring case, so a typed "passport" is Passport) or the empty option, and the server's existing "Select a
 * document type from the list" refusal says the rest.
 */
import accessibleAutocomplete from "accessible-autocomplete";

const SELECTOR = 'select[data-module="app-document-type-autocomplete"]';

/** Wired up from `index.ts` on every page, and a no-op on the ones with no upload form. */
export function initDocumentTypeAutocomplete(): void {
  const select = document.querySelector<HTMLSelectElement>(SELECTOR);
  if (select === null || select.form === null) return;

  const form = select.form;
  const id = select.id;
  accessibleAutocomplete.enhanceSelectElement({ selectElement: select, defaultValue: "", showAllValues: true });

  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement)) return;

  form.addEventListener("submit", () => {
    select.value = optionNamed(select, input.value)?.value ?? "";
  });
}

function optionNamed(select: HTMLSelectElement, typed: string): HTMLOptionElement | undefined {
  const name = typed.trim().toLowerCase();
  const matches = Array.from(select.options).filter((option) => option.value !== "" && (option.textContent ?? "").trim().toLowerCase() === name);
  return matches.length === 1 ? matches[0] : undefined;
}
