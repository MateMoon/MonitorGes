import { beforeEach, describe, expect, it, vi } from "vitest";
import { configurationFingerprint, deliverIndividualReports, type IndividualRecipient, type IndividualReportStore, type IndividualClaim, type IndividualOutcome } from "../src/modules/notificaciones/individual-report-service.js";
import type { ReportGuarantee } from "../src/modules/notificaciones/report-service.js";
import { sendManualIndividualReport } from "../src/modules/notificaciones/manual-individual-report.js";

const date = "2026-11-05";
const user = (id: string, tipos: string[], extra: Partial<IndividualRecipient> = {}): IndividualRecipient => ({ id, email: `${id}@example.test`, activo: true, recibirInformeAutomatico: true, tipos, ...extra });
const row = (id: string, nombreGarantia: string, fechaLimite = date): ReportGuarantee => ({ id, nombreGarantia, fechaLimite, rut: `${id}-5`, nombrePaciente: `Paciente ${id}`, responsable: "Centro de origen" });
let users: Map<string, IndividualRecipient>;
let records: Map<string, { claim: IndividualClaim; outcome?: IndividualOutcome; begun?: boolean; uncertain?: boolean }>;
let rows: ReportGuarantee[];
let store: IndividualReportStore;
beforeEach(() => {
  users = new Map([user("a", ["consulta"]), user("b", ["tratamiento"]), user("c", ["consulta"])].map((entry) => [entry.id, entry]));
  records = new Map(); rows = [row("111", "CONSÚLTA!!!"), row("222", "Tratamiento"), row("333", "Otro tipo")];
  store = {
    candidates: async () => [...users.keys()],
    getRecipient: async (id) => users.get(id) ?? null,
    claim: async (current, date, allowNew) => {
      const key = `${current.id}:${date}`;
      const old = records.get(key);
      if ((old?.outcome && ["ACEPTADO_SMTP", "OMITIDO", "INCIERTO"].includes(old.outcome.estado)) || old?.uncertain) return { reason: "TERMINAL" };
      if (old && !old.outcome) return { reason: "APLAZADO" };
      if (!old && !allowNew) return { reason: "INICIO_TARDIO_SIN_RESERVA" };
      const claim = old?.claim ?? { id: key, usuarioId: current.id, fechaInforme: date, destinatario: current.email.trim().toLowerCase(), huellaConfiguracion: configurationFingerprint(current), tokenReserva: key, numero: 1 };
      records.set(key, { claim }); return { claim };
    },
    begin: async (claim) => { records.get(claim.id)!.begun = true; return true; },
    withLockedRecipient: async (claim, work) => {
      const outcome = await work(users.get(claim.usuarioId) ?? null, async () => rows);
      records.get(claim.id)!.outcome = outcome; return outcome;
    },
    omitExisting: async () => undefined,
    uncertain: async (claim) => { records.get(claim.id)!.uncertain = true; },
  };
});
const run = (mailer: { send: ReturnType<typeof vi.fn> }, allowNew = true) => deliverIndividualReports({ fechaInforme: date, store, mailer, allowNew });

describe("envío manual explícito de una sola cuenta", () => {
  const manual = (send: ReturnType<typeof vi.fn>, patch: Partial<Parameters<typeof sendManualIndividualReport>[0]> = {}) => sendManualIndividualReport({
    usuarioId: "a", fechaInforme: date, confirmedEmail: "a@example.test", confirmedFingerprint: configurationFingerprint(users.get("a")!),
    realDataConfirmed: true, store, mailer: { send }, ...patch,
  });
  it.each([
    { realDataConfirmed: false }, { confirmedEmail: "" }, { confirmedFingerprint: "" },
  ])("exige cada confirmación antes de reservar o llamar SMTP: %j", async (patch) => {
    const send = vi.fn();
    await expect(manual(send, patch)).rejects.toThrow("CONFIRMACION_EXPLICITA_REQUERIDA");
    expect(send).not.toHaveBeenCalled(); expect(records.size).toBe(0);
  });
  it("no acepta un destinatario o un alcance distintos de los confirmados", async () => {
    const send = vi.fn();
    await expect(manual(send, { confirmedEmail: "b@example.test" })).rejects.toThrow("DESTINATARIO_O_TIPOS_NO_CONFIRMADOS");
    await expect(manual(send, { confirmedFingerprint: configurationFingerprint(users.get("b")!) })).rejects.toThrow("DESTINATARIO_O_TIPOS_NO_CONFIRMADOS");
    expect(send).not.toHaveBeenCalled(); expect(records.size).toBe(0);
  });
  it("envía solo A, registra el origen manual y comparte la deduplicación con el programador", async () => {
    const candidates = vi.spyOn(store, "candidates");
    const send = vi.fn().mockResolvedValue({ messageId: "manual-test" });
    const result = await manual(send, { confirmedEmail: " A@example.test " });
    expect(result.resumen).toMatchObject({ usuarios: 1, aceptadosSmtp: 1 });
    expect(result.outcome).toMatchObject({ estado: "ACEPTADO_SMTP", cantidadGarantias: 1, codigoResultado: "ENVIO_MANUAL", messageId: "manual-test" });
    expect(candidates).not.toHaveBeenCalled(); expect(records.size).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: "a@example.test" });
    for (const body of [send.mock.calls[0][0].text, send.mock.calls[0][0].html]) {
      expect(body).toContain("Paciente 111"); expect(body).not.toContain("Paciente 222"); expect(body).not.toContain("Paciente 333");
    }
    await manual(send); expect(send).toHaveBeenCalledTimes(1);
    await run({ send }); expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.slice(1).map(([message]) => message.to)).toEqual(["b@example.test", "c@example.test"]);
  });
  it("rechaza una cuenta no elegible sin cambiar sus preferencias", async () => {
    users.set("a", { ...users.get("a")!, recibirInformeAutomatico: false });
    const send = vi.fn();
    await expect(manual(send)).rejects.toThrow("RECEPCION_DESHABILITADA");
    expect(send).not.toHaveBeenCalled(); expect(records.size).toBe(0);
    expect(users.get("a")?.recibirInformeAutomatico).toBe(false);
  });
  it("no reserva si el correo cambia después de la confirmación inicial", async () => {
    const getRecipient = store.getRecipient;
    let calls = 0;
    store.getRecipient = async (id) => {
      if (++calls === 2) users.set("a", { ...users.get("a")!, email: "nuevo@example.test" });
      return getRecipient(id);
    };
    const send = vi.fn();
    expect((await manual(send)).resumen).toMatchObject({ errores: 1 });
    expect(send).not.toHaveBeenCalled(); expect(records.size).toBe(0);
  });
  it("vuelve a exigir el alcance confirmado bajo bloqueo antes de leer pacientes", async () => {
    const original = store.withLockedRecipient;
    const load = vi.fn(async () => rows);
    store.withLockedRecipient = async (claim, work) => {
      users.set("a", user("a", ["tratamiento"]));
      return original(claim, (current) => work(current, load));
    };
    const send = vi.fn(); const result = await manual(send);
    expect(result.outcome).toMatchObject({ estado: "OMITIDO", codigoResultado: "DESTINATARIO_O_TIPOS_NO_CONFIRMADOS" });
    expect(send).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  });
  it("un fallo manual queda registrado para esa cuenta sin intentar a las demás", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("privado"), { code: "EAUTH", command: "AUTH PLAIN", responseCode: 535 }));
    const result = await manual(send);
    expect(result.resumen).toMatchObject({ usuarios: 1, fallidos: 1, aceptadosSmtp: 0 });
    expect(result.outcome).toMatchObject({ estado: "FALLIDO", cantidadGarantias: 1, reintentable: false });
    expect(send).toHaveBeenCalledTimes(1); expect(records.size).toBe(1);
  });
  it("un error DNS anterior a SMTP permite un reintento sin marcar aceptación", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("detalle DNS privado"), { code: "EDNS", command: "CONN" }));
    const result = await manual(send);
    expect(result.resumen).toMatchObject({ aceptadosSmtp: 0, fallidos: 1, inciertos: 0 });
    expect(result.outcome).toMatchObject({ estado: "FALLIDO", codigoResultado: "EDNS", reintentable: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("informa incertidumbre si SMTP acepta pero falla guardar el resultado", async () => {
    const original = store.withLockedRecipient;
    store.withLockedRecipient = async (claim, work) => { await original(claim, work); throw new Error("persistencia"); };
    const send = vi.fn().mockResolvedValue({ messageId: "smtp-aceptado" });
    const result = await manual(send);
    expect(result.outcome).toMatchObject({ estado: "INCIERTO", cantidadGarantias: 1, codigoResultado: "PERSISTENCIA_INCIERTA" });
    expect(result.resumen).toMatchObject({ inciertos: 1, aceptadosSmtp: 0 });
    await manual(send); expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("aislamiento del contenido individual", () => {
  it("aplica las mismas combinaciones de problema, establecimiento y tipo antes de formatear texto y HTML", async () => {
    users = new Map([["a", user("a", [], { reglasAsignacion: [
      { problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "consulta" },
      { problemaSalud: "hipertension", establecimiento: "centro sur", tipoGarantia: "tratamiento" },
    ] })]]);
    rows = [
      { ...row("111", "CONSÚLTA!!!"), problemaSalud: "DIÁBETES", responsable: "Centro Norte" },
      { ...row("222", "Tratamiento"), problemaSalud: "Hipertensión", responsable: "Centro Sur" },
      { ...row("333", "Consulta"), problemaSalud: "Hipertensión", responsable: "Centro Norte" },
      { ...row("444", "Consulta"), problemaSalud: "Diabetes", responsable: "Centro Sur" },
      { ...row("555", "Tratamiento"), problemaSalud: "Diabetes", responsable: "Centro Norte" },
    ];
    const send = vi.fn().mockResolvedValue({});
    expect(await run({ send })).toMatchObject({ aceptadosSmtp: 1 });
    for (const body of [send.mock.calls[0][0].text, send.mock.calls[0][0].html]) {
      expect(body).toContain("Paciente 111"); expect(body).toContain("Paciente 222");
      for (const id of ["333", "444", "555"]) expect(body).not.toContain(`Paciente ${id}`);
    }
  });
  it("permite cualquier tipo en una regla y omite cuentas sin reglas aunque conserven tipos anteriores", async () => {
    users = new Map([["a", user("a", [], { reglasAsignacion: [{ problemaSalud: "diabetes", establecimiento: "", tipoGarantia: "" }] })]]);
    rows = rows.map((entry) => ({ ...entry, problemaSalud: "Diabetes" }));
    const send = vi.fn().mockResolvedValue({});
    await run({ send }); expect(send).toHaveBeenCalledTimes(1);
    expect(records.get(`a:${date}`)?.outcome?.cantidadGarantias).toBe(3);
    users = new Map([["a", user("a", ["consulta"], { reglasAsignacion: [] })]]);
    expect(await run({ send })).toMatchObject({ omitidos: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("cambiar problema o establecimiento invalida la reserva previa y el orden de reglas no altera la huella", async () => {
    const rules = [{ problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "consulta" }, { problemaSalud: "hipertension", establecimiento: "", tipoGarantia: "tratamiento" }];
    const current = user("a", [], { reglasAsignacion: rules });
    expect(configurationFingerprint(current)).toBe(configurationFingerprint({ ...current, reglasAsignacion: [...rules].reverse() }));
    expect(configurationFingerprint(current)).not.toBe(configurationFingerprint({ ...current, reglasAsignacion: [{ ...rules[0], establecimiento: "centro sur" }] }));
    users = new Map([["a", current]]);
    const original = store.withLockedRecipient;
    store.withLockedRecipient = (claim, work) => {
      users.set("a", { ...current, reglasAsignacion: [{ ...rules[0], problemaSalud: "hipertension" }] });
      return original(claim, work);
    };
    const send = vi.fn(); await run({ send });
    expect(send).not.toHaveBeenCalled();
    expect(records.get(`a:${date}`)?.outcome?.codigoResultado).toBe("CONFIGURACION_CAMBIADA");
  });
  it("A y B reciben solo sus tipos; C comparte consulta sin un correo colectivo", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "smtp-test" });
    expect(await run({ send })).toMatchObject({ aceptadosSmtp: 3 });
    expect(send.mock.calls.map(([message]) => message.to)).toEqual(["a@example.test", "b@example.test", "c@example.test"]);
    for (const [message] of send.mock.calls) {
      expect(typeof message.to).toBe("string"); expect(message).not.toHaveProperty("cc");
      const allowed = message.to === "b@example.test" ? "222" : "111";
      const forbidden = message.to === "b@example.test" ? "111" : "222";
      for (const body of [message.text, message.html]) {
        expect(body).toContain(`Paciente ${allowed}`); expect(body).not.toContain(`Paciente ${forbidden}`); expect(body).not.toContain("Paciente 333");
      }
    }
  });
  it.each([
    { tipos: [] }, { activo: false }, { recibirInformeAutomatico: false }, { email: "no válido" },
  ])("no envía ante un usuario no elegible: %j", async (patch) => {
    users = new Map([["a", user("a", ["consulta"], patch)]]);
    const send = vi.fn(); expect(await run({ send })).toMatchObject({ omitidos: 1 }); expect(send).not.toHaveBeenCalled();
  });
  it("no envía mensajes vacíos ni sustituye por datos generales", async () => {
    users = new Map([["a", user("a", ["sin coincidencia"])]]);
    const send = vi.fn(); await run({ send });
    expect(send).not.toHaveBeenCalled(); expect(records.get(`a:${date}`)?.outcome?.codigoResultado).toBe("SIN_GARANTIAS_ELEGIBLES");
  });
  it("incluye vencidas, normaliza tildes y puntuación y excluye el plazo normal", async () => {
    users = new Map([["a", user("a", ["consulta"])]]);
    rows = [row("111", "CONSÚLTA!!!", "2026-11-01"), row("999", "Consulta", "2026-12-06")];
    const send = vi.fn().mockResolvedValue({}); await run({ send });
    expect(send.mock.calls[0][0].text).toContain("VENCIDA"); expect(send.mock.calls[0][0].html).not.toContain("Paciente 999");
  });
  it("un fallo SMTP no bloquea a otros y reintenta únicamente el usuario fallido", async () => {
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error("no mostrar detalles"), { code: "ETIMEDOUT", command: "CONN" })).mockResolvedValue({});
    expect(await run({ send })).toMatchObject({ aceptadosSmtp: 2, fallidos: 1 });
    expect(records.get(`a:${date}`)?.outcome?.reintentable).toBe(true);
    await run({ send }); expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[3][0].to).toBe("a@example.test"); expect(send.mock.calls[3][0].text).not.toContain("Paciente 222");
  });
  it("no duplica mensajes de usuarios ya aceptados en ejecuciones concurrentes", async () => {
    const send = vi.fn().mockResolvedValue({});
    await Promise.all([run({ send }), run({ send })]);
    expect(send).toHaveBeenCalledTimes(3);
  });
  it.each(["email", "activo", "tipos", "recibirInformeAutomatico"] as const)("revalida %s después de reservar y antes de construir el mensaje", async (field) => {
    users = new Map([["a", user("a", ["consulta"])]]);
    const begin = store.begin;
    store.begin = async (claim) => {
      const acquired = await begin(claim);
      const patch = { email: "otro@example.test", activo: false, tipos: ["tratamiento"], recibirInformeAutomatico: false };
      users.set("a", { ...users.get("a")!, [field]: patch[field] }); return acquired;
    };
    const send = vi.fn(); await run({ send }); expect(send).not.toHaveBeenCalled();
    expect(records.get(`a:${date}`)?.outcome?.estado).toBe("OMITIDO");
  });
  it("una asignación retirada antes de un reintento impide reutilizar su contenido", async () => {
    users = new Map([["a", user("a", ["consulta"])]]);
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error("error"), { code: "ECONNECTION" }));
    await run({ send }); users.set("a", user("a", ["tratamiento"])); await run({ send });
    expect(send).toHaveBeenCalledTimes(1); expect(records.get(`a:${date}`)?.outcome?.codigoResultado).toBe("CONFIGURACION_CAMBIADA");
  });
  it("no registra entrega ni reenvía si falla persistir la aceptación SMTP", async () => {
    users = new Map([["a", user("a", ["consulta"])]]);
    const send = vi.fn().mockResolvedValue({});
    const original = store.withLockedRecipient;
    store.withLockedRecipient = async (claim, work) => { await original(claim, work); throw new Error("persistencia incierta"); };
    expect(await run({ send })).toMatchObject({ inciertos: 1 }); await run({ send }); expect(send).toHaveBeenCalledTimes(1);
  });
  it("un timeout después de DATA queda incierto y no se reintenta", async () => {
    users = new Map([["a", user("a", ["consulta"])]]);
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("detalle privado"), { code: "ETIMEDOUT", command: "DATA" }));
    expect(await run({ send })).toMatchObject({ inciertos: 1 });
    await run({ send }); expect(send).toHaveBeenCalledTimes(1);
    expect(records.get(`a:${date}`)?.outcome?.codigoResultado).toBe("SMTP_RESULTADO_INCIERTO");
  });
  it("el arranque tardío sin reservas no crea mensajes nuevos", async () => {
    const send = vi.fn().mockResolvedValue({});
    const result = await run({ send }, false);
    expect(result.aceptadosSmtp).toBe(0); expect(send).not.toHaveBeenCalled();
    expect(result.motivos.INICIO_TARDIO_SIN_RESERVA).toBe(3);
  });
});
