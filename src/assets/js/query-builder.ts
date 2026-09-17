/**
 * The case-list query builder's one enhancement: choosing a case field or a comparison swaps in the control
 * its value is typed into, with no submit.
 *
 * **It is enhancement over the round trip, never a replacement for it** — the plan's decision 4. With no
 * script running, choosing a comparison and pressing Apply brings the same control back from the server with
 * a hint asking for the value, and the builder still works; that behaviour is the floor and this file only
 * spares a caseworker the trip. So nothing here validates, nothing here submits, and a page whose metadata
 * did not parse simply falls back rather than breaking the form.
 *
 * Three properties are accessibility requirements rather than polish, and each has a line below that keeps
 * it true:
 *
 *   - **No second opinion about the rules.** Which comparisons a field admits, and which control asks for
 *     their values, is read out of `query-builder-metadata` — emitted once by `queryBuilderMetadata` from the
 *     same domain functions the server rendered the rows with. Nothing is fetched per keystroke and no
 *     operator table is restated here. Even the control names come off the row's own data attributes,
 *     because `valueControlName` owns their format.
 *   - **The change is announced.** A control appearing is silent otherwise: it is below the comparison the
 *     caseworker is still in, and a screen reader has no reason to revisit it. `[data-query-announcer]` is
 *     the `aria-live="polite"` region that says so.
 *   - **Focus is never moved.** Moving it on `change` drags a keyboard user out of the select they are
 *     still using — including mid-list, since a `<select>` fires `change` as the arrow keys walk it.
 */
import type { QueryBuilderMetadata, QueryScriptLabels, ValueArity, ValueControl } from "@hmcts/deed-poll";

const METADATA_ID = "query-builder-metadata";

/** govuk-frontend numbers the ids of a tick list from the second item on: `value-0-0`, then `-2`, `-3`. */
const FIRST_NUMBERED_ITEM = 2;

/** The three parts of a date, in the order the date-input component appends them to its `namePrefix`. */
const DATE_PARTS = ["day", "month", "year"] as const;

/** Wired up from `index.ts` on every page, and a no-op on the ones with no builder in them. */
export function initQueryBuilder(): void {
  const metadata = readMetadata();
  if (metadata === null) return;

  const announcer = document.querySelector<HTMLElement>("[data-query-announcer]");
  for (const row of document.querySelectorAll<HTMLElement>("[data-query-row]")) enhanceRow(row, metadata, announcer);
}

/**
 * The metadata the page carries, or `null` when there is none to read.
 *
 * A parse failure is treated as a page with no builder on it: the round trip below this file is what the
 * builder actually runs on, and taking the form down over metadata would trade a working feature for a
 * faster one.
 */
function readMetadata(): QueryBuilderMetadata | null {
  const block = document.getElementById(METADATA_ID);
  if (block === null) return null;

  try {
    return JSON.parse(block.textContent ?? "") as QueryBuilderMetadata;
  } catch {
    return null;
  }
}

/** One condition row: the two choosers watched, and the column their value control lives in. */
function enhanceRow(row: HTMLElement, metadata: QueryBuilderMetadata, announcer: HTMLElement | null): void {
  const field = row.querySelector<HTMLSelectElement>("[data-query-field]");
  const operator = row.querySelector<HTMLSelectElement>("[data-query-operator]");
  const values = row.querySelector<HTMLElement>("[data-query-values]");
  if (field === null || operator === null || values === null) return;

  // What the server already rendered, recorded rather than rebuilt: it came from this same metadata, so the
  // two agree, and rebuilding it would empty a box the caseworker has already typed into.
  values.dataset.querySignature = signature(field.value, operator.value, metadata);

  field.addEventListener("change", () => {
    refreshOperators(operator, field.value, metadata);
    refreshValues(row, field, operator, values, metadata, announcer);
  });
  operator.addEventListener("change", () => refreshValues(row, field, operator, values, metadata, announcer));
}

/**
 * What the comparison chooser offers, rebuilt for the field's kind.
 *
 * Rebuilt rather than left alone because the operators are the kind's: a date admits `is before`, a boolean
 * admits equality and nothing else, and leaving the previous kind's list on screen would offer comparisons
 * the server drops on submit — see `readRow`.
 */
function refreshOperators(operator: HTMLSelectElement, fieldName: string, metadata: QueryBuilderMetadata): void {
  const kind = metadata.fields[fieldName]?.kind;
  const admitted = kind === undefined ? [] : (metadata.kinds[kind]?.operators ?? []);
  const chosen = operator.value;

  operator.replaceChildren(option("", metadata.labels.chooseOperator), ...admitted.map((name) => option(name, metadata.operators[name].label)));
  // A comparison the new kind also admits is kept: changing "New forename contains" to "New surname" should
  // not make the caseworker say "contains" again. One it does not admit goes, which is what the server does
  // with it anyway.
  operator.value = admitted.some((name) => name === chosen) ? chosen : "";
}

/** The value control the row now asks with — swapped in, announced, and left unfocused. */
function refreshValues(
  row: HTMLElement,
  field: HTMLSelectElement,
  operator: HTMLSelectElement,
  values: HTMLElement,
  metadata: QueryBuilderMetadata,
  announcer: HTMLElement | null
): void {
  const next = signature(field.value, operator.value, metadata);
  // The same control as is already on screen, so it stays: swapping `is` for `contains` on a text field asks
  // for the same value, and rebuilding would throw away one already typed.
  if (values.dataset.querySignature === next) return;
  values.dataset.querySignature = next;

  const { control, arity } = controlFor(field.value, operator.value, metadata);
  values.replaceChildren(...valueControls(control, arity, field.value, row.dataset, metadata));
  updateHint(row, field, arity, metadata.labels);
  announce(announcer, row, field, operator, arity, metadata.labels);
}

/**
 * What distinguishes one value control from another: the control, how many of it, and — where its members
 * are the field's option set — which field's.
 */
function signature(fieldName: string, operatorName: string, metadata: QueryBuilderMetadata): string {
  const { control, arity } = controlFor(fieldName, operatorName, metadata);
  const members = control === "select" || control === "checkboxes" ? fieldName : "";

  return `${control}|${arity}|${members}`;
}

/** The control and the arity for a field and a comparison, both of them the metadata's answer and not ours. */
function controlFor(fieldName: string, operatorName: string, metadata: QueryBuilderMetadata): { control: ValueControl; arity: ValueArity } {
  const kind = metadata.fields[fieldName]?.kind;
  const arity = metadata.operators[operatorName]?.arity ?? 0;
  const control = kind === undefined ? "none" : (metadata.kinds[kind]?.controls[String(arity)] ?? "none");

  return { control, arity };
}

/**
 * The controls the comparison asks its value with, built to the markup the GOV.UK macros render.
 *
 * `none` builds nothing at all: `isEmpty` and `isNotEmpty` are complete without a value, and a box beside
 * them would imply one is wanted.
 */
function valueControls(control: ValueControl, arity: ValueArity, fieldName: string, names: DOMStringMap, metadata: QueryBuilderMetadata): Node[] {
  const { labels } = metadata;
  // Off the row's own attributes: `valueControlName` owns the format of a value control's name, and a
  // browser composing one would be a second copy of it.
  const lower = names.valueName ?? "";
  const number = names.conditionNumber ?? "";
  const options = metadata.fields[fieldName]?.options ?? [];

  switch (control) {
    case "none":
      return [];
    case "select":
      return [selectControl(lower, `${labels.value} ${number}`, options, labels.chooseValue)];
    case "checkboxes":
      return [tickList("checkboxes", lower, `${labels.value} ${number}`, options)];
    case "radios":
      return [
        tickList("radios", lower, `${labels.value} ${number}`, [
          { value: "true", text: labels.yes },
          { value: "false", text: labels.no }
        ])
      ];
    default: {
      // `between` asks for both bounds separately, and each says which bound it is — one repeated "Value for
      // condition 2" would leave a screen-reader user to work out which box is the lower.
      const slots = arity === 2 ? [lower, names.upperValueName ?? ""] : [lower];

      return slots.map((name, slot) => {
        const label = `${slots.length === 1 ? labels.value : slot === 0 ? labels.lowerBound : labels.upperBound} ${number}`;

        return control === "date" ? dateControl(name, label, labels) : inputControl(name, label, control === "number" ? "number" : "text");
      });
    }
  }
}

/** One typed-in value, as `govukInput` renders it. */
function inputControl(name: string, labelText: string, type: string): Node {
  const input = element("input", "govuk-input", { id: name, name, type });

  return formGroup([hiddenLabel(name, labelText), input]);
}

/** The three parts of a date, as `govukDateInput` renders them — the component appends the part to the name. */
function dateControl(name: string, labelText: string, labels: QueryScriptLabels): Node {
  const parts = element("div", "govuk-date-input", { id: name });
  for (const part of DATE_PARTS) {
    const partName = `${name}-${part}`;
    const width = part === "year" ? "govuk-input--width-4" : "govuk-input--width-2";
    const label = element("label", "govuk-label govuk-date-input__label", { for: partName });
    label.textContent = labels[part];
    const input = element("input", `govuk-input govuk-date-input__input ${width}`, { id: partName, name: partName, type: "text", inputmode: "numeric" });
    const item = element("div", "govuk-date-input__item");
    item.append(formGroup([label, input]));
    parts.append(item);
  }

  // `role="group"` rather than a bare fieldset, as the component does: three boxes are one question.
  return formGroup([fieldset(labelText, [parts], "group")]);
}

/** An option set as a select, as `govukSelect` renders it, its placeholder above the members. */
function selectControl(name: string, labelText: string, options: { value: string; text: string }[], placeholder: string): Node {
  const select = element("select", "govuk-select", { id: name, name });
  select.append(option("", placeholder), ...options.map((member) => option(member.value, member.text)));

  return formGroup([hiddenLabel(name, labelText), select]);
}

/**
 * Checkboxes or radios sharing one name, as their macros render them.
 *
 * Deliberately without `data-module`: govuk-frontend's `initAll` has already run by the time a control is
 * swapped in, so the attribute would name a component nothing initialises. Neither of these has a
 * conditional reveal to initialise, so there is nothing to lose by leaving it off — and an honest absence
 * beats an attribute that lies.
 */
function tickList(kind: "checkboxes" | "radios", name: string, labelText: string, options: { value: string; text: string }[]): Node {
  const modifiers = kind === "radios" ? "govuk-radios--small govuk-radios--inline" : "govuk-checkboxes--small";
  const list = element("div", `govuk-${kind} ${modifiers}`);

  options.forEach((member, index) => {
    const id = index === 0 ? name : `${name}-${index + FIRST_NUMBERED_ITEM - 1}`;
    const input = element("input", `govuk-${kind}__input`, { id, name, type: kind === "radios" ? "radio" : "checkbox", value: member.value });
    const label = element("label", `govuk-label govuk-${kind}__label`, { for: id });
    label.textContent = member.text;
    const item = element("div", `govuk-${kind}__item`);
    item.append(input, label);
    list.append(item);
  });

  return formGroup([fieldset(labelText, [list])]);
}

/**
 * The row's hint, kept true to the control now on screen.
 *
 * Managed here and not only on the server because the alternative is a lie: a row asked for a value, the
 * caseworker changed the comparison to `is empty`, and *"Enter a value to use this condition"* would still
 * be sitting above a row that needs none. A refusal from api is left alone — it is the more specific thing
 * to say about the row, and the server suppresses the hint beside one for that reason.
 */
function updateHint(row: HTMLElement, field: HTMLSelectElement, arity: ValueArity, labels: QueryScriptLabels): void {
  if (row.querySelector(".govuk-error-message") !== null) return;

  const id = `${field.id}-hint`;
  const existing = document.getElementById(id);
  const wanted = arity === 0 ? "" : arity === 2 ? labels.enterBothValues : labels.enterValue;

  if (wanted === "") {
    existing?.remove();
    if (field.getAttribute("aria-describedby") === id) field.removeAttribute("aria-describedby");

    return;
  }

  const hint = existing ?? row.insertBefore(element("p", "govuk-hint", { id }), row.firstElementChild);
  hint.textContent = wanted;
  // Announced with the row's first control, as the server does it: the row is what is unfinished, not one
  // control of it.
  field.setAttribute("aria-describedby", id);
}

/**
 * What the live region says about the change, naming the condition it happened to.
 *
 * Silent when the row holds no comparison: a caseworker who has just changed the field is going to the
 * comparison chooser next, and announcing that a control has gone would talk over the move they are making.
 */
function announce(
  announcer: HTMLElement | null,
  row: HTMLElement,
  field: HTMLSelectElement,
  operator: HTMLSelectElement,
  arity: ValueArity,
  labels: QueryScriptLabels
): void {
  if (announcer === null || field.value === "" || operator.value === "") return;

  const message = arity === 0 ? labels.announceNoValue : arity === 2 ? labels.announceValues : labels.announceValue;
  announcer.textContent = message.replace("{n}", row.dataset.conditionNumber ?? "");
}

/** The wrapper every GOV.UK control sits in. */
function formGroup(children: Node[]): HTMLElement {
  const group = element("div", "govuk-form-group");
  group.append(...children);

  return group;
}

/** A fieldset whose legend is for a screen reader only — the visible label is the column the control is in. */
function fieldset(labelText: string, children: Node[], role?: string): HTMLElement {
  const legend = element("legend", "govuk-fieldset__legend govuk-visually-hidden");
  legend.textContent = labelText;
  const group = element("fieldset", "govuk-fieldset", role === undefined ? {} : { role });
  group.append(legend, ...children);

  return group;
}

/** The same, for a control that takes a `<label>` rather than a legend. */
function hiddenLabel(forId: string, text: string): HTMLElement {
  const label = element("label", "govuk-label govuk-visually-hidden", { for: forId });
  label.textContent = text;

  return label;
}

function option(value: string, text: string): HTMLOptionElement {
  const node = element("option", "", { value });
  node.textContent = text;

  return node;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attributes: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);

  return node;
}
