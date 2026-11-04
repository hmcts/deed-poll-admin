import { ConflictError, findMasters, InvalidInputError, NotFoundError, saveMasterChange } from "@hmcts/deed-poll";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { saveMasterChangePage, showMasterChange } from "./master-change.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findMasters: vi.fn(),
  saveMasterChange: vi.fn()
}));

const CALLER = { accessToken: "dm-token" };
const ID = "6f1c1d4e-2a5b-4c3d-8e9f-0a1b2c3d4e5f";
const MASTER = { id: ID, name: "Master Wren", email: "wren@example.test", available: true, linked: true, revision: 3 };
const BODY = { name: " Master Wren ", email: "wren@example.test", available: "false", revision: "3" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findMasters).mockResolvedValue([MASTER]);
  vi.mocked(saveMasterChange).mockResolvedValue({ ...MASTER, revision: 4 });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function request(options: { masterId?: string; body?: unknown } = {}) {
  return pageRequest({ deliveryManager: true, accessToken: "dm-token", params: { masterId: options.masterId ?? ID }, body: options.body });
}

function model(res: ReturnType<typeof pageResponse>) {
  return res.render.mock.calls[0]?.[1];
}

describe("a Master's Change page GET", () => {
  it("should draw the Master from the list at its revision, saying whether they have signed in", async () => {
    // Arrange
    const res = pageResponse();

    // Act
    await showMasterChange(request(), res);

    // Assert
    expect(findMasters).toHaveBeenCalledExactlyOnceWith(CALLER);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.render.mock.calls[0]?.[0]).toBe("deed-polls/settings/master");
    expect(model(res).master).toEqual({
      path: `/deed-polls/settings/masters/${ID}`,
      isLinked: true,
      values: { name: "Master Wren", email: "wren@example.test", available: "true", revision: "3" },
      errors: {}
    });
    expect(model(res)).toMatchObject({ title: "Change a Master", backLink: "/deed-polls/settings#masters", errorList: [] });
  });

  it("should answer NotFoundError for a Master who is not on the list", async () => {
    await expect(showMasterChange(request({ masterId: "7f1c1d4e-2a5b-4c3d-8e9f-0a1b2c3d4e5f" }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("should refuse a dot-segment id before any read", async () => {
    await expect(showMasterChange(request({ masterId: ".." }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);

    expect(findMasters).not.toHaveBeenCalled();
  });
});

describe("a Master's Change page POST", () => {
  it("should send every field at the original revision and redirect to the Masters section", async () => {
    const res = pageResponse();

    await saveMasterChangePage(request({ body: BODY }), res);

    expect(saveMasterChange).toHaveBeenCalledExactlyOnceWith(ID, { name: "Master Wren", email: "wren@example.test", available: false, revision: 3 }, CALLER);
    expect(findMasters).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/settings?saved=master-changed#masters");
  });

  it("should redraw the body with its original revision and each control's error, writing nothing", async () => {
    const res = pageResponse();

    await saveMasterChangePage(request({ body: { name: "", email: "wren@", available: "maybe", revision: "3" } }), res);

    expect(saveMasterChange).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(model(res).master).toEqual({
      path: `/deed-polls/settings/masters/${ID}`,
      isLinked: true,
      values: { name: "", email: "wren@", available: "maybe", revision: "3" },
      errors: {
        name: "Enter the Master’s name, up to 200 characters",
        email: "Enter the Master’s email address, like name@example.com",
        available: "Select whether the Master is available for referrals"
      }
    });
    expect(model(res).errorList.map((each: { href: string }) => each.href)).toEqual(["#master-name", "#master-email", "#available"]);
  });

  it("should ask for a reload, with no field errors, when the revision is not one the page sent", async () => {
    const res = pageResponse();

    await saveMasterChangePage(request({ body: { ...BODY, revision: "x" } }), res);

    expect(model(res).master).toMatchObject({ errors: {}, reloadText: "Reload the Master before saving" });
    expect(model(res).errorList).toEqual([{ text: "Reload the Master before saving", href: "#reload-master" }]);
  });

  it("should say another Master has the address when api's 409 names the email", async () => {
    vi.mocked(saveMasterChange).mockRejectedValue(new ConflictError("Another Master already has this email address.", [{ field: "email", message: "x" }]));
    const res = pageResponse();

    await saveMasterChangePage(request({ body: BODY }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(model(res).master).toMatchObject({ values: { revision: "3" }, errors: { email: "Another Master already has this email address" } });
    expect(model(res).master.reloadText).toBeUndefined();
  });

  it("should require a reload, keeping the typed values, when api's 409 is a stale revision", async () => {
    vi.mocked(saveMasterChange).mockRejectedValue(new ConflictError("This Master has changed."));
    const res = pageResponse();

    await saveMasterChangePage(request({ body: BODY }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(model(res).master).toMatchObject({
      values: { name: " Master Wren ", revision: "3" },
      errors: {},
      reloadText: "This Master has changed since you opened this page. Reload the Master and check the current details before saving again."
    });
  });

  it("should put api's 400 on the control it names, and ask for a reload when it names the revision", async () => {
    vi.mocked(saveMasterChange).mockRejectedValueOnce(new InvalidInputError("x", [{ field: "name", message: "x" }]));
    vi.mocked(saveMasterChange).mockRejectedValueOnce(new InvalidInputError("x", [{ field: "revision", message: "x" }]));
    const named = pageResponse();
    const revision = pageResponse();

    await saveMasterChangePage(request({ body: BODY }), named);
    await saveMasterChangePage(request({ body: BODY }), revision);

    expect(model(named).master).toMatchObject({ errors: { name: "Enter the Master’s name, up to 200 characters" } });
    expect(model(named).master.reloadText).toBeUndefined();
    expect(model(revision).master.reloadText).toBe("Reload the Master before saving");
  });

  it.each([[[{ field: "other", message: "x" }]], [[]]])("should refuse in general terms when api's 400 names %j", async (fieldErrors) => {
    vi.mocked(saveMasterChange).mockRejectedValue(new InvalidInputError("x", fieldErrors));
    const res = pageResponse();

    await saveMasterChangePage(request({ body: BODY }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(model(res).master).toMatchObject({ errors: {}, reloadText: "The Master could not be saved. Reload the settings and try again." });
    expect(model(res).errorList).toContainEqual({ text: "The Master could not be saved. Reload the settings and try again.", href: "#reload-master" });
  });

  it("should let a 404 for a Master no longer listed reach the not-found page", async () => {
    vi.mocked(saveMasterChange).mockRejectedValue(new NotFoundError("No such Master"));

    await expect(saveMasterChangePage(request({ body: BODY }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each([
    ["has not signed in", [{ ...MASTER, linked: false }], false],
    ["is no longer listed", [], false]
  ])("should leave the sign-in warning off a refused save when the Master %s", async (_case, masters, isLinked) => {
    vi.mocked(findMasters).mockResolvedValue(masters);
    const res = pageResponse();

    await saveMasterChangePage(request({ body: { ...BODY, name: "" } }), res);

    expect(model(res).master.isLinked).toBe(isLinked);
  });

  it("should show the sign-in warning on a refused save when whether the Master signed in cannot be read", async () => {
    vi.mocked(findMasters).mockRejectedValue(new Error("api down"));
    const res = pageResponse();

    await saveMasterChangePage(request({ body: { ...BODY, name: "" } }), res);

    expect(model(res).master.isLinked).toBe(true);
  });

  it("should refuse a dot-segment id before any write", async () => {
    await expect(saveMasterChangePage(request({ masterId: ".", body: BODY }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);

    expect(saveMasterChange).not.toHaveBeenCalled();
  });
});
