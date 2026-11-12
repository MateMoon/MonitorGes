import { describe, expect, it, vi } from "vitest";
import { readEmailAutomationConfig, scheduledExecutionKey, timeInSantiago } from "../src/modules/notificaciones/automation-config.js";
import { buildGuaranteeReport, deliverConfiguredDailyReport, deliverDailyReport, formatGuaranteeReport, formatGuaranteeReportHtml, sendManualConfiguredReport } from "../src/modules/notificaciones/report-service.js";
import { isTransientEmailFailure, MAX_EMAIL_ATTEMPTS } from "../src/modules/notificaciones/email-retry-policy.js";

const today = "2026-10-13";
const sample = (id: string, days: number, nombreGarantia = `Garantía ${id}`) => ({
  id,
  nombreGarantia,
  rut: "12345678-5",
  nombrePaciente: "Paciente de prueba",
  fechaLimite: new Date(Date.parse(`${today}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10),
  responsable: "Centro ficticio",
});

describe("informes diarios de correo", () => {
  it("bloquea las tres entradas antiguas de envío global sin contactar SMTP", async () => {
    const mailer = { send: vi.fn() };
    for (const legacy of [deliverDailyReport, deliverConfiguredDailyReport, sendManualConfiguredReport]) await expect(legacy({ mailer })).rejects.toThrow("GLOBAL_REPORT_DISABLED");
    expect(mailer.send).not.toHaveBeenCalled();
  });
  it("mantiene la configuración apagada por defecto y los reintentos acotados", () => {
    expect(readEmailAutomationConfig({}).enabled).toBe(false);
    expect(MAX_EMAIL_ATTEMPTS).toBe(5);
    expect(isTransientEmailFailure({ responseCode: 421 })).toBe(true);
    expect(isTransientEmailFailure({ code: "EAUTH" })).toBe(false);
  });
  it("usa los umbrales existentes y excluye garantías normales", () => {
    const report = buildGuaranteeReport([sample("31", 31), sample("30", 30), sample("15", 15), sample("7", 7), sample("0", 0), sample("-1", -1)], today);
    expect(report.map(({ id, estado }) => [id, estado])).toEqual([
      ["0", "critica"], ["7", "critica"], ["15", "proxima"], ["30", "atencion"], ["-1", "vencida"],
    ]);
  });
  it("habilita deduplicación por defecto y solo permite desactivarla en QA", () => {
    expect(readEmailAutomationConfig({})).toEqual({ enabled: false, time: "08:00", dedupEnabled: true });
    const qa = { DATABASE_URL: "postgresql://localhost/monitor_garantias_qa", AUTO_EMAIL_ENABLED: "true", AUTO_EMAIL_TIME: "10:00", EMAIL_DEDUP_ENABLED: "false" };
    const config = readEmailAutomationConfig(qa);
    expect(config).toEqual({ enabled: true, time: "10:00", dedupEnabled: false });
    expect(scheduledExecutionKey(config)).toBe("programado:10:00");
    expect(scheduledExecutionKey({ ...config, dedupEnabled: true })).toBe("diario");
    expect(() => readEmailAutomationConfig({ ...qa, DATABASE_URL: "postgresql://localhost/produccion" })).toThrow("solo está permitido");
    expect(() => readEmailAutomationConfig({ EMAIL_DEDUP_ENABLED: "no" })).toThrow("EMAIL_DEDUP_ENABLED");
    expect(() => readEmailAutomationConfig({ ...qa, AUTO_EMAIL_TIME: "25:00" })).toThrow("AUTO_EMAIL_TIME");
  });
  it("usa la fecha de Santiago en medianoche y su desfase de invierno", () => {
    expect(timeInSantiago(new Date("2026-11-06T02:30:00Z"))).toEqual({ date: "2026-11-05", time: "23:30" });
    expect(timeInSantiago(new Date("2026-07-05T13:00:00Z"))).toEqual({ date: "2026-07-05", time: "09:00" });
  });

  it("calcula días civiles y obtiene fecha/hora local de Santiago", () => {
    const report = buildGuaranteeReport([sample("vence-hoy", 0), sample("atrasada", -3)], today);
    expect(report.map(({ diasRestantes }) => diasRestantes)).toEqual([0, -3]);
    expect(timeInSantiago(new Date("2026-10-13T12:00:00.000Z"))).toEqual({ date: "2026-10-13", time: "09:00" });
  });

  it("ordena por prioridad y luego por fecha límite", () => {
    const report = buildGuaranteeReport([sample("c-7", 7), sample("c-2", 2), sample("expired-1", -1), sample("attention", 20)], today);
    expect(report.map(({ id }) => id)).toEqual(["c-2", "c-7", "attention", "expired-1"]);
  });

  it("mantiene las mismas garantías y el mismo orden en las versiones de texto y HTML", () => {
    const rows = buildGuaranteeReport([sample("z", 7), sample("expired", -1), sample("soon", 15)], today);
    const text = formatGuaranteeReport(rows, today);
    const html = formatGuaranteeReportHtml(rows, today);
    const textOrder = rows.map(({ nombreGarantia }) => text.indexOf(nombreGarantia));
    const htmlOrder = rows.map(({ nombreGarantia }) => html.indexOf(nombreGarantia));
    expect(htmlOrder.every((position) => position >= 0)).toBe(true);
    expect(textOrder).toEqual([...textOrder].sort((a, b) => a - b));
    expect(htmlOrder).toEqual([...htmlOrder].sort((a, b) => a - b));
    expect(html).toContain('background:#fbe7e5;color:#a12a22');
    expect(html).toContain('border-left:4px solid #cc4339');
    expect(html).toContain('background:#e4e7ec;color:#2c3542');
  });

  it("escapa todos los valores dinámicos del HTML, incluidos valores vacíos", () => {
    const row = {
      ...buildGuaranteeReport([sample("x", 1)], today)[0],
      nombreGarantia: `A&B <C> "D" 'E'`,
      nombrePaciente: `María <script>alert("paciente")</script> & D'Ávila`,
      responsable: "",
    };
    const html = formatGuaranteeReportHtml([row], `2026<&>\"'`);
    expect(html).toContain("A&amp;B &lt;C&gt; &quot;D&quot; &#39;E&#39;");
    expect(html).toContain("2026&lt;&amp;&gt;&quot;&#39;");
    expect(html).not.toContain(`A&B <C> "D" 'E'`);
    expect(html).toContain("María &lt;script&gt;alert(&quot;paciente&quot;)&lt;/script&gt; &amp; D&#39;Ávila");
    expect(html).not.toContain("<script>");
    expect(formatGuaranteeReport([row], today)).toContain(`Paciente: ${row.nombrePaciente}`);
    expect(html).toContain("<td style=\"padding:12px;border-bottom:1px solid #e5e7eb\"></td>");
  });


});
