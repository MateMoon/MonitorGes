import { describe, expect, it } from "vitest";
import { getDaysRemaining, getGuaranteeStatus } from "../src/modules/garantias/status.js";

describe("días y estado de garantía", () => {
  const today = "2026-10-08";
  it.each([[31, "normal"], [30, "atencion"], [16, "atencion"], [15, "proxima"], [8, "proxima"], [7, "critica"], [1, "critica"], [0, "critica"], [-1, "vencida"]] as const)("clasifica correctamente %i días", (days, status) => {
    const target = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
    expect(getDaysRemaining(target, today)).toBe(days);
    expect(getGuaranteeStatus(target, today)).toBe(status);
  });
});
