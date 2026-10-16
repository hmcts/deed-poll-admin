import appInsights from "applicationinsights";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "./track-event.js";

vi.mock("applicationinsights", () => ({ default: { defaultClient: { trackEvent: vi.fn() } } }));

const client = { trackEvent: vi.fn() };

describe("trackEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appInsights).defaultClient = client as never;
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when Application Insights is initialized", () => {
    it("should send the event as a customEvent with its properties", () => {
      trackEvent("auth.logout", { subject: "subject-1", route: "/logout" });

      expect(client.trackEvent).toHaveBeenCalledWith({ name: "auth.logout", properties: { subject: "subject-1", route: "/logout" } });
    });

    it("should write no console line, because App Insights is the one sink", () => {
      trackEvent("auth.logout", { subject: "subject-1" });

      expect(console.info).not.toHaveBeenCalled();
    });
  });

  describe("when Application Insights is not initialized", () => {
    beforeEach(() => {
      vi.mocked(appInsights).defaultClient = undefined as never;
    });

    it("should write one JSON console.info line instead", () => {
      trackEvent("auth.logout", { subject: "subject-1", route: "/logout" });

      expect(console.info).toHaveBeenCalledTimes(1);
      const [line] = vi.mocked(console.info).mock.calls[0] as [string];
      expect(JSON.parse(line)).toEqual({ event: "auth.logout", properties: { subject: "subject-1", route: "/logout" } });
    });

    it("should write an empty properties object when none is given", () => {
      trackEvent("auth.logout");

      const [line] = vi.mocked(console.info).mock.calls[0] as [string];
      expect(JSON.parse(line)).toEqual({ event: "auth.logout", properties: {} });
    });
  });
});
