import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { addPathFilters } from "../../path-filters.js";
import { GET, POST } from "./new.js";

const environment = nunjucks.configure(
  [
    fileURLToPath(new URL("..", import.meta.resolve("govuk-frontend"))),
    fileURLToPath(new URL("../../../libs/express-govuk-starter/src/govuk-frontend/views", import.meta.url)),
    fileURLToPath(new URL("../../../libs/express-govuk-starter/src/cookies/views", import.meta.url)),
    fileURLToPath(new URL("..", import.meta.url))
  ],
  { autoescape: true }
);
addPathFilters(environment);

const html = (model: Record<string, unknown>): string => environment.render("deed-polls/new.njk", { ...(model.en as object), ...model });

describe("new deed poll template", () => {
  it("should ask for the old name and leave the new name for the Application tab", () => {
    const res = pageResponse();

    GET(pageRequest(), res);
    const markup = html(res.render.mock.calls[0][1]);

    expect(markup).toMatch(/for="oldForename"[\s\S]*?Old forename/);
    expect(markup).toMatch(/for="oldSurname"[\s\S]*?Old surname/);
    expect(markup).toContain('name="oldForename"');
    expect(markup).toContain('name="oldSurname"');
    expect(markup).not.toContain('name="newForename"');
    expect(markup).not.toContain('name="newSurname"');
  });

  it("should retain the old name and link its validation error when creation is rejected", async () => {
    const res = pageResponse();
    const oldForename = "A".repeat(1001);

    await POST(pageRequest({ body: { type: "Minor", oldForename, oldSurname: "Lovelace" } }), res);
    const markup = html(res.render.mock.calls[0][1]);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(markup).toContain('href="#oldForename"');
    expect(markup).toContain(`value="${oldForename}"`);
    expect(markup).toContain('value="Lovelace"');
  });
});
