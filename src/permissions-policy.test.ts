import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { permissionsPolicy } from "./permissions-policy.js";

describe("permissionsPolicy", () => {
  it("should deny every listed browser feature to the page and every frame in it", async () => {
    const app = express();
    app.use(permissionsPolicy());
    app.get("/", (_req, res) => {
      res.send("ok");
    });

    const response = await request(app).get("/");

    expect(response.headers["permissions-policy"]).toBe(
      "accelerometer=(), autoplay=(), bluetooth=(), browsing-topics=(), camera=(), display-capture=(), fullscreen=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), xr-spatial-tracking=()"
    );
  });

  it("should set the header before any later layer answers, so an error page carries it too", async () => {
    const app = express();
    app.use(permissionsPolicy());
    app.use((_req, res) => {
      res.status(404).send("Page not found");
    });

    const response = await request(app).get("/missing");

    expect(response.status).toBe(404);
    expect(response.headers["permissions-policy"]).toContain("camera=()");
  });
});
