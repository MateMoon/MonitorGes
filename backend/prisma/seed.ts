import "dotenv/config";
import { PrismaClient, type EstadoImportacion } from "@prisma/client";

const prisma = new PrismaClient();
const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TIME_ZONE ?? "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) + "T00:00:00.000Z");
const plusDays = (days: number) => new Date(today.getTime() + days * 86400000);

async function main() {
  await prisma.errorImportacion.deleteMany();
  await prisma.importacion.deleteMany();
  await prisma.garantia.deleteMany();
  await prisma.paciente.deleteMany();

  const patients = [
    ["11111111", "1", "Paciente Ficticio Uno"], ["22222222", "2", "Paciente Ficticio Dos"],
    ["33333333", "3", "Paciente Ficticio Tres"], ["44444444", "4", "Paciente Ficticio Cuatro"],
    ["55555555", "5", "Paciente Ficticio Cinco"], ["66666666", "6", "Paciente Ficticio Seis"],
  ] as const;
  const created = await Promise.all(patients.map(([rutNumero, dv, nombre]) => prisma.paciente.create({ data: { rutNumero, dv, nombre } })));
  const entries = [
    [created[0], -1, "Vencida ficticia"], [created[1], 0, "Vence hoy ficticia"], [created[2], 7, "Crítica ficticia"],
    [created[3], 8, "Próxima ficticia"], [created[4], 15, "Próxima 15 días ficticia"], [created[5], 16, "Atención ficticia"],
    [created[0], 30, "Atención 30 días ficticia"], [created[1], 31, "Normal ficticia"], [created[2], 60, "Normal futura ficticia"],
  ] as const;
  await prisma.garantia.createMany({ data: entries.map(([paciente, days, nombreGarantia]) => ({ pacienteId: paciente.id, problemaSalud: "Problema ficticio", nombreGarantia, fechaInicio: plusDays(-30), fechaLimite: plusDays(days), responsable: "Centro Ficticio de Salud" })) });
  await prisma.importacion.create({ data: { nombreArchivo: "semilla-ficticia.xlsx", estado: "COMPLETADA" satisfies EstadoImportacion, registrosLeidos: entries.length, registrosNuevos: entries.length } });
}

main().finally(async () => prisma.$disconnect());
