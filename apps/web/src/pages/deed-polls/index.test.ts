import { findDeedPolls } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./index.js";

// The filters and the row formatting are the domain's, and tested there. Only the api call is
// replaced, so this exercises the page against the real filter and view-model logic.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPolls: vi.fn()
}));

const record = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  privacy: "Normal",
  dateReceived: new Date("2026-03-01T00:00:00.000Z"),
  type: "Adult",
  state: "Received",
  newForename: "Ada"
};

describe("deed-polls list page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPolls).mockResolvedValue([] as never);
  });

  it("renders its own template, qualified by directory so it cannot be shadowed by pages/index.njk", async () => {
    vi.mocked(findDeedPolls).mockResolvedValue([record] as never);
    const res = pageResponse();

    await GET(pageRequest(), res);

    expect(res.render).toHaveBeenCalledWith(
      "deed-polls/index",
      expect.objectContaining({
        cases: [expect.objectContaining({ id: "case-1", reference: "KBDP2026-00001", dateReceived: "1 March 2026", type: "Adult" })]
      })
    );
  });

  it("asks for the default filter when none was chosen, so the default view is everything", async () => {
    await GET(pageRequest(), pageResponse());

    expect(findDeedPolls).toHaveBeenCalledWith("all", expect.anything());
  });

  it("sends api the key of the requested filter, rather than a clause of its own", async () => {
    await GET(pageRequest({ query: { filter: "enroled" } }), pageResponse());

    expect(findDeedPolls).toHaveBeenCalledWith("enroled", expect.anything());
  });

  it("falls back to 'all' for an unrecognised filter rather than erroring", async () => {
    const res = pageResponse();

    await GET(pageRequest({ query: { filter: "nonsense" } }), res);

    expect(findDeedPolls).toHaveBeenCalledWith("all", expect.anything());
    expect(res.render).toHaveBeenCalledWith("deed-polls/index", expect.objectContaining({ activeFilter: "all" }));
  });

  it("presents the caseworker's own token, so api authenticates and audits as them", async () => {
    await GET(pageRequest({ accessToken: "caseworker-token" }), pageResponse());

    expect(findDeedPolls).toHaveBeenCalledWith("all", { accessToken: "caseworker-token" });
  });

  it("marks the active filter so the tab bar can show which is current", async () => {
    const res = pageResponse();

    await GET(pageRequest({ query: { filter: "open" } }), res);

    expect(res.render).toHaveBeenCalledWith("deed-polls/index", expect.objectContaining({ activeFilter: "open" }));
  });

  it("passes the filter tabs without their where clauses", async () => {
    const res = pageResponse();

    await GET(pageRequest(), res);

    const model = res.render.mock.calls[0][1];
    for (const tab of model.filters) {
      expect(Object.keys(tab)).toEqual(["key", "label"]);
    }
  });

  it("provides both en and cy content objects", async () => {
    const res = pageResponse();

    await GET(pageRequest(), res);

    const model = res.render.mock.calls[0][1];
    expect(Object.keys(model.en)).toEqual(Object.keys(model.cy));
  });

  it("renders an empty case list without failing, so the empty state is the template's job", async () => {
    const res = pageResponse();

    await GET(pageRequest(), res);

    expect(res.render).toHaveBeenCalledWith("deed-polls/index", expect.objectContaining({ cases: [] }));
  });
});
