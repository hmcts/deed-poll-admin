/**
 * The case list's own markup, rendered rather than asserted through the view model.
 *
 * The view model is tested where it is built (`query-builder.test.ts`); what this file exists for is the
 * one thing a model cannot show: that the builder is **usable with JavaScript disabled**. Add and Remove
 * being submit buttons inside a GET form, and the value control actually being the one the field's kind
 * asks for, are properties of the template — and the plan's decision 7 is that a query builder which dies
 * with a CSP change is worse than a slower one.
 *
 * The model comes from the page handler rather than being hand-built here, so a name the handler stops
 * passing fails this test too. `en` is spread over it because `renderInterceptorMiddleware` is what does
 * that in a real request, and the double does not run middleware.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countAwaitingConfirmation, countReturnedForAction, findDeedPolls, findSavedQueries, InvalidInputError } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  countAwaitingConfirmation: vi.fn(),
  countReturnedForAction: vi.fn(),
  findDeedPolls: vi.fn(),
  findSavedQueries: vi.fn()
}));

// The three roots `configureGovuk` mounts, minus the assets it also wires up: govuk-frontend's macros,
// the starter's layouts, and this app's pages.
const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../..", "pages")
  ],
  { autoescape: true }
);

/** One row, since the table — and so its sortable headers — renders only for a result set with rows in it. */
const record = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  privacy: "Normal",
  dateReceived: new Date("2026-03-01T00:00:00.000Z"),
  type: "Adult",
  state: "Received",
  newForename: "Ada",
  newSurname: "Lovelace"
};

/** The list page as a browser receives it, for the query the URL carries. */
const render = async (query: Record<string, unknown> = {}): Promise<string> => {
  const res = pageResponse();
  await GET(pageRequest({ query }), res);
  const model = res.render.mock.calls[0][1];

  return environment.render("deed-polls/index.njk", { ...model.en, ...model });
};

/**
 * The `name="…"` attributes of every control in the markup, which is what a GET form submits.
 *
 * The leading space is load-bearing: the rows also carry `data-value-name`, which is the name of a control
 * the *browser* may build rather than a control being submitted, and matching it would count a control that
 * is not there.
 */
const controlNames = (markup: string): string[] => [...markup.matchAll(/ name="([^"]+)"/g)].map((match) => match[1]);

describe("deed-polls list template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPolls).mockResolvedValue({ filter: "all", cases: [], page: 1, size: 25, total: 0, totalPages: 0 } as never);
    vi.mocked(findSavedQueries).mockResolvedValue([] as never);
    vi.mocked(countReturnedForAction).mockResolvedValue(0);
    vi.mocked(countAwaitingConfirmation).mockResolvedValue(0);
  });

  it("submits the builder as a GET, because the URL is the query and a POST could not be bookmarked", async () => {
    const markup = await render();

    expect(markup).toContain('<form method="get" action="/deed-polls"');
  });

  it("carries the tab through the builder, so applying a query stays on the tab it was built on", async () => {
    const markup = await render({ filter: "enroled" });

    expect(markup).toContain('<input type="hidden" name="filter" value="enroled">');
  });

  it("carries the search term through the builder, so applying a filter narrows the search", async () => {
    const markup = await render({ q: "Smith" });

    expect(markup).toContain('<input type="hidden" name="q" value="Smith">');
  });

  it("carries no hidden search control when nothing was searched, rather than submitting an empty q", async () => {
    // Scoped to the hidden control: the search box itself is always `name="q"`, and it is the builder's
    // copy of the term that must not appear when there is no term to carry.
    const markup = await render();

    expect(markup).not.toContain('<input type="hidden" name="q"');
  });

  it("adds and removes rows with submit buttons, so the builder needs no JavaScript at all", async () => {
    const markup = await render({ where: "type:is:Adult" });

    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*name="add"/);
    // Its own row's index, so removing the first row does not need JavaScript to say which row it was.
    expect(markup).toMatch(/<button[^>]*type="submit" value="0" name="remove"/);
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*name="apply"/);
  });

  it("joins the rows with the word and, since api ANDs them and offers no other choice", async () => {
    const markup = await render({ where: ["type:is:Adult", "state:is:Received"] });
    const joins = markup.match(/>and</g) ?? [];

    expect(joins).toHaveLength(1);
  });

  it("needs no joining word for a single row", async () => {
    const markup = await render({ where: "type:is:Adult" });

    expect(markup.match(/>and</g)).toBeNull();
  });

  it("asks for a date with the three parts of a date input", async () => {
    const markup = await render({ where: "dateReceived:is:2026-03-01" });

    expect(controlNames(markup)).toEqual(expect.arrayContaining(["value-0-0-day", "value-0-0-month", "value-0-0-year"]));
    expect(markup).toContain('value="2026"');
  });

  it("asks for both bounds of a between separately", async () => {
    const markup = await render({ where: "dateReceived:between:2026-03-01,2026-04-01" });

    expect(controlNames(markup)).toEqual(expect.arrayContaining(["value-0-0-day", "value-0-1-day"]));
  });

  it("asks for an enum with a select of its members, with the chosen one selected", async () => {
    const markup = await render({ where: "type:is:Minor" });

    expect(markup).toMatch(/<select[^>]*name="value-0-0"/);
    expect(markup).toContain('<option value="Minor" selected>Minor</option>');
  });

  it("asks for isOneOf with checkboxes sharing one name, which is how a set arrives", async () => {
    const markup = await render({ where: "type:isOneOf:Adult,Minor" });

    expect(markup).toMatch(/<input class="govuk-checkboxes__input" id="value-0-0" name="value-0-0" type="checkbox" value="Adult" checked>/);
    expect(controlNames(markup).filter((name) => name === "value-0-0")).toHaveLength(6);
  });

  it("asks for a boolean with Yes and No radios", async () => {
    const markup = await render({ where: "inPerson:is:true" });

    expect(markup).toMatch(/<input class="govuk-radios__input"[^>]*type="radio" value="true" checked>/);
    expect(markup).toContain("Yes");
  });

  it("asks for a number with a number input", async () => {
    const markup = await render({ where: "ageOfMinor:gt:4" });

    expect(markup).toContain('id="value-0-0" name="value-0-0" type="number" value="4">');
  });

  it("asks for text with a text input", async () => {
    const markup = await render({ where: "newForename:contains:Ada" });

    expect(markup).toContain('id="value-0-0" name="value-0-0" type="text" value="Ada">');
  });

  it("renders no value control at all for isEmpty, so nothing implies a value is wanted", async () => {
    const markup = await render({ where: "parents:isEmpty" });

    expect(controlNames(markup)).not.toContain("value-0-0");
    expect(controlNames(markup)).toEqual(expect.arrayContaining(["field-0", "op-0"]));
  });

  it("offers only the operators the chosen field's kind admits", async () => {
    const markup = await render({ where: "inPerson:is:true" });
    const operators = markup.slice(markup.indexOf('name="op-0"'));

    expect(operators.slice(0, operators.indexOf("</select>"))).not.toContain("contains");
  });

  it("announces a refused row with its own controls, so a screen reader reaches the error from the row", async () => {
    vi.mocked(findDeedPolls).mockRejectedValue(new InvalidInputError("Case query is not valid", [{ field: "where.0", message: "names no case field" }]));

    const markup = await render({ where: "type:is:Adult" });

    expect(markup).toContain('id="field-0-error" class="govuk-error-message"');
    expect(markup).toMatch(/id="field-0"[^>]*aria-describedby="field-0-error"/);
    expect(markup).toContain("govuk-form-group--error");
  });

  it("asks for a missing value with a hint and no error markup, since the row is a step part-way through", async () => {
    const markup = await render({ where: "type:is:" });

    expect(markup).toContain('id="field-0-hint" class="govuk-hint">Enter a value to use this condition');
    expect(markup).toMatch(/id="field-0"[^>]*aria-describedby="field-0-hint"/);
    // The three ways this could be dressed up as a mistake, and is not: an error message, an errored form
    // group, and an entry in the error summary.
    expect(markup).not.toContain("govuk-error-message");
    expect(markup).not.toContain("govuk-form-group--error");
    expect(markup).not.toContain("govuk-error-summary");
    // And the control the hint is asking for a value in is on screen, which is the whole point.
    expect(markup).toMatch(/<select[^>]*name="value-0-0"/);
  });

  it("states an unused condition above the table, where a caseworker reading the results will see it", async () => {
    vi.mocked(findDeedPolls).mockResolvedValue({ filter: "all", cases: [record], page: 1, size: 25, total: 1, totalPages: 1 } as never);

    const markup = await render({ where: ["type:is:Adult", "newForename:is:"] });
    const statement = markup.indexOf("Condition 2 was not used, because it is not complete.");

    expect(statement).toBeGreaterThan(-1);
    expect(markup.indexOf('class="govuk-inset-text"')).toBeLessThan(markup.indexOf("<table"));
    expect(statement).toBeLessThan(markup.indexOf("<table"));
  });

  it("states nothing when every condition ran, so the page is quiet about a query it answered in full", async () => {
    const markup = await render({ where: "type:is:Adult" });

    expect(markup).not.toContain("govuk-inset-text");
    expect(markup).not.toContain("was not used");
  });

  it("offers the saved-query pages as links outside the builder's form, since saving is a page of its own", async () => {
    const markup = await render({ filter: "open", where: "type:is:Adult" });
    const afterForm = markup.slice(markup.lastIndexOf("</form>"));

    // Read after the last `</form>` so a link that drifted inside the GET form — where it would submit the
    // builder rather than open the save page — fails rather than passing on a substring match.
    expect(afterForm).toContain('href="/deed-polls/queries/new?filter=open&amp;where=type%3Ais%3AAdult"');
    expect(afterForm).toContain('href="/deed-polls/queries"');
  });

  it("shows every field the chooser offers, and not the ones api computes", async () => {
    const markup = await render();

    expect(markup).toContain('<option value="state">State</option>');
    expect(markup).not.toContain('value="daysReceivedToEnroled"');
  });

  it("groups the field chooser by tab and section, so the fields are not one flat list of 43", async () => {
    const markup = await render();
    const chooser = markup.slice(markup.indexOf('name="field-0"'));
    const groups = [...chooser.slice(0, chooser.indexOf("</select>")).matchAll(/<optgroup label="([^"]+)">/g)].map((match) => match[1]);

    expect(groups).toContain("Application: Names");
    expect(groups).toContain("Enrolment");
    // The placeholder is above every group rather than inside the first one, where it would be announced
    // as one of that section's fields.
    expect(chooser.indexOf("Choose a case field")).toBeLessThan(chooser.indexOf("<optgroup"));
  });

  /**
   * The enhancement's half of the page, which is markup and metadata and no behaviour: the browser swapping
   * a control in is driven in `deed-polls.spec.ts`, because a DOM is the only place it can be. What a
   * template test can hold is that everything the script reads is on the page and that none of it is a
   * second copy of a domain rule.
   */
  describe("the value control's enhancement", () => {
    /** The metadata block as the browser parses it. */
    const metadataFrom = (markup: string): Record<string, any> => {
      const opening = '<script type="application/json" id="query-builder-metadata">';
      const start = markup.indexOf(opening) + opening.length;

      return JSON.parse(markup.slice(start, markup.indexOf("</script>", start)));
    };

    it("carries the field, operator and control metadata once, as JSON the browser can parse", async () => {
      const markup = await render();
      const metadata = metadataFrom(markup);

      expect(metadata.fields.type).toEqual({ kind: "enum", options: expect.arrayContaining([{ value: "Adult", text: "Adult" }]) });
      expect(metadata.operators.between).toEqual({ label: "is between", arity: 2 });
      expect(metadata.kinds.date.operators).toContain("before");
      expect(metadata.kinds.date.controls["1"]).toBe("date");
      // The words the swapped-in controls read, which have no macro to default them.
      expect(metadata.labels.chooseValue).toBe("Choose a value");
      expect(metadata.labels.announceValue).toContain("{n}");
      // Once, so the page is not carrying the same table per row.
      expect([...markup.matchAll(/id="query-builder-metadata"/g)]).toHaveLength(1);
    });

    it("gives each row the names the script needs, rather than leaving it to compose them", async () => {
      const markup = await render({ where: "dateReceived:between:2026-03-01,2026-04-01" });

      expect(markup).toContain('data-query-row="0"');
      expect(markup).toContain('data-condition-number="1"');
      expect(markup).toContain('data-value-name="value-0-0"');
      expect(markup).toContain('data-upper-value-name="value-0-1"');
    });

    it("marks the two choosers and the column the control is swapped into", async () => {
      const markup = await render();

      expect(markup).toMatch(/<select[^>]*id="field-0"[^>]*data-query-field/);
      expect(markup).toMatch(/<select[^>]*id="op-0"[^>]*data-query-operator/);
      expect(markup).toContain('<div class="govuk-grid-column-one-quarter" data-query-values>');
    });

    it("gives the builder one polite live region, empty until something changes", async () => {
      const markup = await render();

      expect(markup).toContain('<div class="govuk-visually-hidden" aria-live="polite" data-query-announcer></div>');
      // Polite and not assertive: a control appearing is not worth interrupting a caseworker mid-sentence.
      expect(markup).not.toContain('aria-live="assertive"');
    });

    it("still asks for the value with a plain control, so the page works with the script blocked", async () => {
      const markup = await render({ where: "type:is:" });

      // The metadata is a data block, not a script: nothing on this page executes to make the builder work.
      expect(markup).toMatch(/<select[^>]*name="value-0-0"/);
      expect(markup).toMatch(/<button[^>]*type="submit"[^>]*name="apply"/);
    });
  });

  it("keeps the chosen field selected inside its group, so the round trip comes back showing it", async () => {
    const markup = await render({ where: "newSurname:is:Lovelace" });

    expect(markup).toMatch(/<optgroup label="Application: Names">[\s\S]*?<option value="newSurname" selected>New surname<\/option>/);
  });

  it("selects a field no group offers above the groups, so the worklist the count links to shows and resubmits its filter", async () => {
    // The URL the dashboard's "returned — action needed" link produces. `currentReferralState` is deliberately
    // not in the chooser (it sits on no form tab), so without an option of its own the select would submit the
    // placeholder's empty value and the next Apply would answer the whole caseload under a count that says it
    // is filtered.
    const markup = await render({ where: "currentReferralState:is:Decided" });
    const chooser = markup.slice(markup.indexOf('name="field-0"'));

    expect(chooser).toContain('<option value="currentReferralState" selected>Current referral state</option>');
    expect(chooser.indexOf('value="currentReferralState"')).toBeLessThan(chooser.indexOf("<optgroup"));
    // And the state itself, from the option set rather than from a blank chooser.
    expect(markup).toMatch(/<select[^>]*name="value-0-0"[\s\S]*?<option value="Decided" selected>Decided<\/option>/);
  });

  /**
   * The "returned — action needed" banner, which is the one part of this page whose whole purpose is to be
   * seen: the count replaces a shared-mailbox poll, so where it sits and whether it is reachable by keyboard
   * are the properties that decide whether it works at all.
   */
  describe("the returned-for-action banner", () => {
    /** The banner on its own, so "it carries the worklist link" cannot be satisfied by the rest of the page. */
    const banner = (markup: string): string => markup.match(/<div class="govuk-notification-banner[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";

    it("renders nothing when nothing needs action, so there is no permanent banner to learn to ignore", async () => {
      const markup = await render();

      expect(markup).not.toContain("govuk-notification-banner");
      expect(markup).not.toContain("needing action");
      // And no warning either: a zero is an answer, so there is nothing to apologise for.
      expect(markup).not.toContain("govuk-warning-text");
    });

    describe("when the count could not be read", () => {
      /** Suppressed here; the handler's log line is asserted in `index.test.ts`, which owns that side. */
      const failedRender = async (): Promise<string> => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(countReturnedForAction).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
        const markup = await render();
        logged.mockRestore();

        return markup;
      };

      // The whole point of the change: silence and zero used to be the same rendering.
      it("says the count could not be loaded, rather than rendering the nothing a zero renders", async () => {
        const markup = await failedRender();

        expect(markup).toContain("govuk-warning-text");
        expect(markup).toContain("could not be loaded");
        expect(markup).toContain("cannot say whether any need action");
      });

      it("does not claim a count, since it has none — no banner and no number", async () => {
        const markup = await failedRender();

        expect(markup).not.toContain("govuk-notification-banner");
        expect(markup).not.toContain("needing action");
      });

      it("offers no worklist link, which would lead to a list nothing said was the right one", async () => {
        const markup = await failedRender();

        expect(markup).not.toContain("View these applications");
      });

      it("still renders the page around it, the count being one element and not the page", async () => {
        const markup = await failedRender();

        expect(markup).toContain("<h1");
        expect(markup).toContain('role="search"');
      });
    });

    it("states the count above everything else on the page, since a banner below the builder is not an alert", async () => {
      vi.mocked(countReturnedForAction).mockResolvedValue(4);

      const markup = await render();

      expect(markup).toContain("4 applications have a returned direction needing action");
      expect(markup.indexOf("govuk-notification-banner")).toBeLessThan(markup.indexOf("<h1"));
      expect(markup.indexOf("govuk-notification-banner")).toBeLessThan(markup.indexOf('role="search"'));
    });

    it("carries the worklist as a plain link, so clicking the count runs the query that produced it", async () => {
      vi.mocked(countReturnedForAction).mockResolvedValue(4);

      const markup = await render();

      // A link and not a control: no script runs on this page, and the worklist is a URL that can be
      // bookmarked and shared like every other set of results.
      expect(banner(markup)).toContain(
        '<a class="govuk-notification-banner__link" href="/deed-polls?where=currentReferralState%3Ais%3ADecided">View these applications</a>'
      );
    });

    it("announces itself as a region with the banner's own title, rather than as an unlabelled div", async () => {
      vi.mocked(countReturnedForAction).mockResolvedValue(1);

      const markup = await render();

      expect(banner(markup)).toContain('role="region"');
      expect(banner(markup)).toContain('aria-labelledby="govuk-notification-banner-title"');
      expect(banner(markup)).toContain('<p class="govuk-notification-banner__heading">1 application has a returned direction needing action</p>');
    });

    it("keeps the count out of the list's own filter, so the banner reads the same on every tab", async () => {
      vi.mocked(countReturnedForAction).mockResolvedValue(2);

      const markup = await render({ filter: "enroled", where: "type:is:Adult" });

      expect(banner(markup)).toContain("2 applications have a returned direction needing action");
      expect(banner(markup)).toContain('href="/deed-polls?where=currentReferralState%3Ais%3ADecided"');
    });
  });

  /**
   * The "awaiting confirmation" alert — `notify-3b` decision 3. It shares the one notification banner with the
   * returned-direction count, because GOV.UK's guidance is one banner per page: what these tests own is that
   * sharing it has not made either count able to change how the other renders.
   */
  describe("the awaiting-confirmation banner", () => {
    const banner = (markup: string): string => markup.match(/<div class="govuk-notification-banner[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";

    it("renders nothing when nothing is waiting, so there is no permanent banner to learn to ignore", async () => {
      const markup = await render();

      expect(markup).not.toContain("govuk-notification-banner");
      expect(markup).not.toContain("waiting for the applicant to confirm");
      expect(markup).not.toContain("govuk-warning-text");
    });

    it("states the count above everything else on the page, with its own link to the worklist", async () => {
      vi.mocked(countAwaitingConfirmation).mockResolvedValue(6);

      const markup = await render();

      expect(banner(markup)).toContain("6 applications are waiting for the applicant to confirm they want to proceed");
      expect(banner(markup)).toContain(
        '<a class="govuk-notification-banner__link" href="/deed-polls?filter=awaitingConfirmation">View applications awaiting confirmation</a>'
      );
      expect(markup.indexOf("govuk-notification-banner")).toBeLessThan(markup.indexOf("<h1"));
    });

    it("shares the one banner when both worklists have work, rather than stacking two Important banners", async () => {
      vi.mocked(countReturnedForAction).mockResolvedValue(4);
      vi.mocked(countAwaitingConfirmation).mockResolvedValue(6);

      const markup = await render();

      // Counted by the banner's own landmark, which the component renders once per banner.
      expect(markup.match(/aria-labelledby="govuk-notification-banner-title"/g)).toHaveLength(1);
      expect(banner(markup)).toContain("4 applications have a returned direction needing action");
      expect(banner(markup)).toContain("6 applications are waiting for the applicant to confirm they want to proceed");
      // Two links, because they are two worklists — and worded differently, since identical link text reads as
      // two ways to the same place to anyone tabbing through them.
      expect(banner(markup)).toContain("View these applications");
      expect(banner(markup)).toContain("View applications awaiting confirmation");
    });

    it("drops only its own paragraph when nothing is waiting, leaving the other alert as it was", async () => {
      vi.mocked(countReturnedForAction).mockResolvedValue(4);

      const markup = await render();

      expect(banner(markup)).toContain("4 applications have a returned direction needing action");
      expect(banner(markup)).not.toContain("waiting for the applicant to confirm");
    });

    describe("when the count could not be read", () => {
      /** Suppressed here; the handler's log line is asserted in `index.test.ts`, which owns that side. */
      const failedRender = async (): Promise<string> => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(countAwaitingConfirmation).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
        const markup = await render();
        logged.mockRestore();

        return markup;
      };

      it("says the count could not be loaded, rather than rendering the nothing a zero renders", async () => {
        const markup = await failedRender();

        expect(markup).toContain("govuk-warning-text");
        expect(markup).toContain("cannot say whether any are waiting");
      });

      it("claims no count and offers no worklist link, which would lead to a list nothing vouched for", async () => {
        const markup = await failedRender();

        expect(markup).not.toContain("govuk-notification-banner");
        expect(markup).not.toContain("View applications awaiting confirmation");
      });

      it("leaves the other count's alert alone, since one unreadable number says nothing about the other", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(countReturnedForAction).mockResolvedValue(4);
        vi.mocked(countAwaitingConfirmation).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

        const markup = await render();
        logged.mockRestore();

        expect(markup).toContain("govuk-warning-text");
        expect(markup).toContain("4 applications have a returned direction needing action");
      });

      it("shows one warning per unreadable count, so neither failure hides the other", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(countReturnedForAction).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
        vi.mocked(countAwaitingConfirmation).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

        const markup = await render();
        logged.mockRestore();

        // The component's own text element, which is one per warning — the class itself appears four times in each.
        expect(markup.match(/class="govuk-warning-text__text"/g)).toHaveLength(2);
        expect(markup).toContain("cannot say whether any need action");
        expect(markup).toContain("cannot say whether any are waiting");
      });

      it("still renders the page around it, the count being one element and not the page", async () => {
        const markup = await failedRender();

        expect(markup).toContain("<h1");
        expect(markup).toContain('role="search"');
      });
    });
  });

  /**
   * The Waiting column — `notify-3b` decision 4. The cell is on every row of the view model, so what the
   * template owns is that only the awaiting-confirmation tab renders it, and that it is plain text: no header
   * link and no `aria-sort`, because api's longest-waiting order is the order the worklist exists to present.
   */
  describe("the waiting column", () => {
    const waiting = { ...record, daysAwaitingConfirmation: 14 };

    /** The head row on its own, so an assertion about the headings cannot be satisfied by a body cell. */
    const head = (markup: string): string => markup.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? "";

    it("adds the heading and the cell on the awaiting-confirmation tab", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ filter: "awaitingConfirmation", cases: [waiting], page: 1, size: 25, total: 1, totalPages: 1 } as never);

      const markup = await render({ filter: "awaitingConfirmation" });

      expect(head(markup)).toContain("Waiting");
      expect(markup).toContain("14 days");
    });

    it("renders it as plain text with no sort link, so api's longest-waiting order cannot be replaced", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ filter: "awaitingConfirmation", cases: [waiting], page: 1, size: 25, total: 1, totalPages: 1 } as never);

      const markup = await render({ filter: "awaitingConfirmation" });

      // Every other heading is a link with an aria-sort; this one is the last cell of the head and neither.
      expect(head(markup)).toMatch(/Waiting<\/th>\s*<\/tr>/);
      expect(head(markup)).not.toMatch(/aria-sort="[a-z]+"[^>]*>\s*<a[^>]*>[^<]*Waiting/);
    });

    it("adds neither on any other tab, since a workflow column should not occupy space on every list", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ filter: "returned", cases: [waiting], page: 1, size: 25, total: 1, totalPages: 1 } as never);

      const markup = await render({ filter: "returned" });

      expect(head(markup)).not.toContain("Waiting");
      expect(markup).not.toContain("14 days");
    });

    it("keeps the head and the body the same width, so the column lines up with its heading", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ filter: "awaitingConfirmation", cases: [waiting], page: 1, size: 25, total: 1, totalPages: 1 } as never);

      const markup = await render({ filter: "awaitingConfirmation" });
      const bodyRow = markup.match(/<tbody[\s\S]*?<\/tr>/)?.[0] ?? "";

      expect(head(markup).match(/<th[ >]/g)).toHaveLength(8);
      expect(bodyRow.match(/<t[hd]/g)).toHaveLength(8);
    });
  });

  describe("the search form", () => {
    /**
     * The search form on its own, so "the search carries the filter" cannot be satisfied by the builder
     * form below it, which carries the same value under the same name.
     */
    const searchForm = (markup: string): string => markup.match(/<form[^>]*role="search"[\s\S]*?<\/form>/)?.[0] ?? "";

    it("sits above the filter bar, since searching is how a caseworker enters the list", async () => {
      const markup = await render();

      expect(searchForm(markup)).not.toBe("");
      expect(markup.indexOf('role="search"')).toBeLessThan(markup.indexOf('<nav class="app-filter-nav"'));
    });

    it("submits as a GET, so a set of results is a URL that can be bookmarked and shared", async () => {
      const form = searchForm(await render());

      expect(form).toContain('<form method="get" action="/deed-polls"');
    });

    it("asks for the term with a native search input, so it needs no JavaScript", async () => {
      const form = searchForm(await render());

      expect(form).toMatch(/<input[^>]*id="q"[^>]*name="q"[^>]*type="search"/);
      expect(form).toContain("Search cases");
      expect(form).toContain("Enter a full case reference, or part of any name on the case.");
    });

    it("shows the term that was searched, so refining a search starts from it", async () => {
      const form = searchForm(await render({ q: "Smith" }));

      expect(form).toMatch(/<input[^>]*name="q"[^>]*value="Smith"/);
    });

    it("shows an empty box when nothing was searched, rather than the word undefined", async () => {
      const form = searchForm(await render());

      expect(form).toMatch(/<input[^>]*name="q"[^>]*value=""/);
      expect(form).not.toContain("undefined");
    });

    it("carries the active query as hidden inputs, so a search narrows it instead of replacing it", async () => {
      // api ANDs q with filter and where — decision 4 — so the form has to be able to say
      // "Smith, within Enroled, received in June".
      const form = searchForm(await render({ filter: "enroled", where: ["type:is:Adult", "state:is:Received"], sort: "state:desc" }));

      expect(form).toContain('<input type="hidden" name="filter" value="enroled">');
      expect(form).toContain('<input type="hidden" name="where" value="type:is:Adult">');
      expect(form).toContain('<input type="hidden" name="where" value="state:is:Received">');
      expect(form).toContain('<input type="hidden" name="sort" value="state:desc">');
    });

    it("carries no page, so a new search starts at its own first page", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ filter: "all", cases: [record], page: 4, size: 25, total: 213, totalPages: 9 } as never);

      const form = searchForm(await render({ page: "4" }));

      expect(form).not.toContain('name="page"');
    });

    it("leaves a blank builder row out of its hidden inputs, since a row holding nothing narrows nothing", async () => {
      const form = searchForm(await render({ where: [":", "type:is:Adult"] }));

      expect(form).toContain('<input type="hidden" name="where" value="type:is:Adult">');
      expect(form).not.toContain('name="where" value=":"');
    });
  });

  describe("the filter bar", () => {
    /** The nav on its own, so an assertion about what the bar carries cannot be satisfied by the rest of the page. */
    const filterNav = (markup: string): string => markup.match(/<nav class="app-filter-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";

    /**
     * One group of the bar, since the saved-query group renders the same markup as the status group.
     *
     * A count of items across the whole `<nav>` was the plan-10 assertion, and it would now be satisfied by
     * five items spread over two groups — so a count of statuses is scoped to the group it counts.
     */
    const group = (nav: string, index: number): string => [...nav.matchAll(/<div class="app-filter-nav__group">[\s\S]*?<\/div>/g)][index]?.[0] ?? "";

    it("renders the tabs as a list, because a set of sibling destinations is one", async () => {
      const nav = filterNav(await render());

      expect(nav).toContain('<ul class="app-filter-nav__list">');
      expect([...group(nav, 0).matchAll(/<li class="app-filter-nav__item">/g)]).toHaveLength(6);
    });

    it("marks the current tab with aria-current=page rather than a strong, since you-are-here is not importance", async () => {
      const nav = filterNav(await render({ filter: "enroled" }));

      expect(nav).toContain('<span class="app-filter-nav__current" aria-current="page">Enroled</span>');
      expect(nav).not.toContain("<strong");
      expect(nav).not.toContain('aria-current="true"');
      // One current entry, so the other five are still links to somewhere.
      expect([...nav.matchAll(/aria-current=/g)]).toHaveLength(1);
    });

    it("does not fade the tabs a caseworker has already used, which would read as progress through them", async () => {
      const nav = filterNav(await render());

      expect([...nav.matchAll(/class="govuk-link govuk-link--no-visited-state"/g)]).toHaveLength(5);
    });

    it("leaves the spacing to the component, so the markup carries no override utilities", async () => {
      const nav = filterNav(await render());

      expect(nav).not.toContain("govuk-!-");
    });

    it("renders the caseworker's selected queries as a second group of the same markup", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([
        {
          id: "q-1",
          name: "Adult, open",
          description: null,
          filter: "open",
          conditions: ["type:is:Adult"],
          sortField: null,
          sortDirection: null,
          shared: false,
          selected: true,
          editable: true
        }
      ] as never);

      const nav = filterNav(await render({ filter: "open", where: "type:is:Adult" }));

      expect([...nav.matchAll(/<div class="app-filter-nav__group">/g)]).toHaveLength(2);
      // Unpublished, so it is the caller's own group rather than the library's — plan 14.
      expect(group(nav, 1)).toContain('<h2 class="app-filter-nav__group-label">Your queries</h2>');
      // The request is that query, so its entry says "you are here" rather than linking to where you are.
      expect(group(nav, 1)).toContain('<span class="app-filter-nav__current" aria-current="page">Adult, open</span>');
    });

    it("renders a third group of the same markup when the selection spans both kinds, with no template change", async () => {
      // The markup names no group and simply iterates `filterGroups`, which is what let the bar grow from two
      // groups to three. This test is the proof of that claim rather than the plan's assertion of it.
      vi.mocked(findSavedQueries).mockResolvedValue([
        {
          id: "mine",
          name: "Mine",
          description: null,
          filter: "open",
          conditions: [],
          sortField: null,
          sortDirection: null,
          shared: false,
          selected: true,
          editable: true
        },
        {
          id: "theirs",
          name: "Everyone's",
          description: null,
          filter: "returned",
          conditions: [],
          sortField: null,
          sortDirection: null,
          shared: true,
          selected: true,
          editable: false
        }
      ] as never);

      const nav = filterNav(await render({ filter: "open" }));

      expect([...nav.matchAll(/<div class="app-filter-nav__group">/g)]).toHaveLength(3);
      expect(group(nav, 1)).toContain('<h2 class="app-filter-nav__group-label">Your queries</h2>');
      expect(group(nav, 2)).toContain('<h2 class="app-filter-nav__group-label">Query library</h2>');
      expect(group(nav, 2)).toContain("Everyone&#39;s");
    });

    it("links a selected query that is not the one being looked at, carrying its whole query in the URL", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([
        {
          id: "q-1",
          name: "Adult, open",
          description: null,
          filter: "open",
          conditions: ["type:is:Adult"],
          sortField: null,
          sortDirection: null,
          shared: false,
          selected: true,
          editable: true
        }
      ] as never);

      const nav = filterNav(await render());

      expect(group(nav, 1)).toContain(
        '<a class="govuk-link govuk-link--no-visited-state" href="/deed-polls?filter=open&amp;where=type%3Ais%3AAdult">Adult, open</a>'
      );
    });

    it("labels the group, ready for plan 11's saved queries to sit in a second one", async () => {
      const nav = filterNav(await render());

      expect(nav).toMatch(/<div class="app-filter-nav__group">\s*<h2 class="app-filter-nav__group-label">Status<\/h2>/);
      // Wording true of every group the bar can hold, since the second one is saved queries and not
      // statuses — plan 11's decision 4. The group's own label is what says "status".
      expect(nav).toContain('aria-label="Filter cases"');
      expect(nav).not.toContain("Filter by status");
    });

    it("renders one group when the caseworker has selected no queries, so an empty labelled group is never drawn", async () => {
      const nav = filterNav(await render());

      expect([...nav.matchAll(/<div class="app-filter-nav__group">/g)]).toHaveLength(1);
    });

    /**
     * The stylesheet and not the markup, because "distinguishable by something other than weight" is a rule
     * about how the current entry is drawn — and the only other place that claim could live is a screenshot.
     */
    it("distinguishes the current tab with a border, not by boldness alone", async () => {
      const partial = await readFile(path.join(fileURLToPath(import.meta.url), "../../../assets/css/components/_filter-nav.scss"), "utf8");
      const currentRule = partial.match(/\.app-filter-nav__current \{[^}]*\}/)?.[0] ?? "";

      expect(currentRule).toMatch(/border-bottom: \d+px solid/);
    });
  });

  describe("the order and the page", () => {
    /** One page of a longer result set: the counts a caseworker pages through. */
    const results = (page: number) => ({ filter: "all", cases: [record], page, size: 25, total: 213, totalPages: 9 });

    it("makes each column heading a link, so reordering needs no JavaScript either", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(results(1) as never);

      const markup = await render();

      expect(markup).toContain('<a class="govuk-link" href="/deed-polls?sort=dateReceived%3Aasc">');
      expect(markup).toContain("Sort by </span>Received");
    });

    it("marks how the table is ordered with aria-sort, which the link text does not say", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(results(1) as never);

      const markup = await render({ sort: "state:desc" });

      expect(markup).toMatch(/<th[^>]*aria-sort="descending"[^>]*>\s*<a class="govuk-link" href="\/deed-polls\?sort=state%3Aasc"/);
      expect([...markup.matchAll(/aria-sort="none"/g)]).toHaveLength(6);
    });

    it("shows the surname the search may have matched on, with a sortable header of its own", async () => {
      // Decision 6: a row array shorter than the header loop renders a table whose cells sit under the
      // wrong headings, so the cell and the header are asserted together.
      vi.mocked(findDeedPolls).mockResolvedValue(results(1) as never);

      const markup = await render();

      expect(markup).toContain('<a class="govuk-link" href="/deed-polls?sort=newSurname%3Aasc">');
      expect(markup).toContain("Sort by </span>New surname");
      expect([...markup.matchAll(/<th /g)]).toHaveLength(7);
      expect(markup).toContain("Lovelace");
    });

    it("carries the order through the builder as a control of its own, since the form submits as a GET", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(results(1) as never);

      const markup = await render({ sort: "state:desc" });

      expect(markup).toContain('<input type="hidden" name="sort" value="state:desc">');
    });

    it("carries no sort control when the table is in api's own order, rather than naming a default", async () => {
      const markup = await render();

      expect(markup).not.toContain('name="sort"');
    });

    it("states the range and the total in words, from api's counts", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(results(4) as never);

      const markup = await render({ page: "4" });

      expect(markup).toContain("76 to 100 of 213 applications");
    });

    it("renders the pagination with the pages api says there are", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(results(4) as never);

      const markup = await render({ page: "4" });

      expect(markup).toContain('<nav class="govuk-pagination"');
      expect(markup).toContain('href="/deed-polls?page=3" rel="prev"');
      expect(markup).toContain('href="/deed-polls?page=5" rel="next"');
      expect(markup).toContain('aria-label="Page 9"');
      expect(markup).toContain("&ctdot;");
    });

    it("renders no pagination when one page holds everything", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ filter: "all", cases: [record], page: 1, size: 25, total: 1, totalPages: 1 } as never);

      const markup = await render();

      expect(markup).not.toContain("govuk-pagination");
      expect(markup).toContain("1 to 1 of 1 applications");
    });
  });
});
