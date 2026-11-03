// Diagnóstico de solo lectura. No importa server.ts, no envía correos ni aplica SQL de migración.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { PrismaClient, Prisma } from "@prisma/client";

const TARGET = "monitor_garantias_qa";
const MIGRATION = "20261103120000_guarantee_management_timeline";
class VerificationError extends Error {}
function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new VerificationError(message);
}
const tables = ["Paciente", "Garantia", "Usuario", "SesionUsuario", "Importacion", "ErrorImportacion", "ConfiguracionNotificaciones", "EnvioInformeCorreo", "IntentoEnvioCorreo", "Establecimiento", "ProblemaSalud", "TipoGarantia", "CombinacionProblemaGarantia", "AreaResponsabilidad"];
type MigrationRow = { migration_name: string; checksum: string; finished: boolean; rolled_back: boolean };
type Fingerprint = { rows: number; fingerprint: string };
type Snapshot = { database: string; capturedAt: string; tables: Record<string, Fingerprint>; legacyCount: number; migrationChecksum: string };

async function main() {
  const [mode = "--inspect", snapshotFile, ...extra] = process.argv.slice(2);
  requireCondition(["--inspect", "--before", "--after"].includes(mode) && extra.length === 0, "Usa --inspect, --before <snapshot.json> o --after <snapshot.json>.");
  requireCondition(mode === "--inspect" ? !snapshotFile : snapshotFile, "Indica el archivo de snapshot para --before o --after.");
  let backendRoot = path.resolve(import.meta.dirname, "..");
  if (!fs.existsSync(path.join(backendRoot, "prisma/schema.prisma"))) backendRoot = path.resolve(backendRoot, "..");
  requireCondition(fs.existsSync(path.join(backendRoot, "prisma/schema.prisma")), "No se encontró el backend del proyecto.");
  const fileEnv = dotenv.parse(fs.readFileSync(path.join(backendRoot, ".env")));
  const url = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
  const databaseName = (value: string | undefined) => {
    try { return decodeURIComponent(new URL(value!).pathname.slice(1)); } catch { return null; }
  };
  requireCondition(databaseName(fileEnv.DATABASE_URL) === TARGET && databaseName(url) === TARGET, "Destino incorrecto: .env y la conexión efectiva deben identificar monitor_garantias_qa. No se abrió conexión.");
  process.env.AUTO_EMAIL_ENABLED = "false";
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [identity] = await tx.$queryRawUnsafe<Array<{ database: string; read_only: string }>>("SELECT current_database() AS database, current_setting('transaction_read_only') AS read_only");
      requireCondition(identity.database === TARGET && identity.read_only === "on", "La conexión abierta no cumple el destino QA y solo lectura.");
      const migrations = await tx.$queryRawUnsafe<MigrationRow[]>('SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" ORDER BY started_at');
      requireCondition(!migrations.some((row) => !row.finished && !row.rolled_back), "Hay un intento de migración fallido o incompleto. Revisarlo antes de desplegar.");
      const migrationRoot = path.join(backendRoot, "prisma/migrations");
      const local = fs.readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
        const checksum = createHash("sha256").update(fs.readFileSync(path.join(migrationRoot, entry.name, "migration.sql"))).digest("hex");
        const applied = migrations.find((row) => row.migration_name === entry.name && row.finished && !row.rolled_back);
        return { name: entry.name, checksum, applied: Boolean(applied), checksumMatches: applied ? checksum === applied.checksum : null };
      });
      requireCondition(local.every((row) => row.checksumMatches !== false), "Un archivo SQL aplicado difiere de su checksum registrado. Revisar antes de continuar.");
      requireCondition(migrations.every((row) => local.some((entry) => entry.name === row.migration_name)), "QA contiene migraciones que no están en este checkout.");
      const columns = await tx.$queryRawUnsafe<Array<{ column_name: string }>>("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Garantia' AND column_name IN ('estadoGestion','revisionGestion') ORDER BY column_name");
      const eventTable = await tx.$queryRawUnsafe<Array<{ present: boolean }>>("SELECT to_regclass('public.\"EventoGarantia\"') IS NOT NULL AS present");
      const enums = await tx.$queryRawUnsafe<Array<{ typname: string }>>("SELECT typname FROM pg_type WHERE typname IN ('EstadoGestion','TipoActuacion','TipoEventoGarantia') ORDER BY typname");
      const fingerprints: Record<string, Fingerprint> = {};
      for (const table of tables) {
        // Los identificadores proceden exclusivamente de la lista fija anterior.
        const projection = table === "Garantia" ? "to_jsonb(t) - 'estadoGestion' - 'revisionGestion'" : "to_jsonb(t)";
        const [value] = await tx.$queryRawUnsafe<Fingerprint[]>(`SELECT count(*)::int AS rows, md5(coalesce(string_agg((${projection})::text,'' ORDER BY t.id),'')) AS fingerprint FROM "${table}" t`);
        fingerprints[table] = value;
      }
      const [legacy] = await tx.$queryRawUnsafe<Array<{ count: number; orphan_users: number }>>('SELECT count(*) FILTER (WHERE g."gestionadaAt" IS NOT NULL)::int AS count, count(*) FILTER (WHERE g."gestionadaPorUsuarioId" IS NOT NULL AND u.id IS NULL)::int AS orphan_users FROM "Garantia" g LEFT JOIN "Usuario" u ON u.id=g."gestionadaPorUsuarioId"');
      requireCondition(legacy.orphan_users === 0, "Hay gestores sin referencia válida. Revisar antes de migrar.");
      const migration = local.find((entry) => entry.name === MIGRATION);
      requireCondition(migration, "Falta el archivo local de la migración de seguimiento.");
      const pending = local.filter((entry) => !entry.applied).map((entry) => entry.name);
      if (mode === "--before") {
        requireCondition(pending.length === 1 && pending[0] === MIGRATION, "No existe exactamente la migración pendiente aprobable para esta etapa.");
        requireCondition(columns.length === 0 && !eventTable[0].present && enums.length === 0, "Hay estructuras nuevas parciales o ya aplicadas. Revisar antes de desplegar.");
      }
      if (mode === "--after") {
        requireCondition(migration.applied && pending.length === 0 && columns.length === 2 && eventTable[0].present && enums.length === 3, "La migración o las estructuras nuevas aún no están completas. No iniciar el backend.");
        const [invariants] = await tx.$queryRawUnsafe<Array<{ bad_states: number; bad_legacy: number; events: number }>>(`SELECT
          (SELECT count(*)::int FROM "Garantia" WHERE "revisionGestion" <> 0 OR "estadoGestion"::text <> CASE WHEN "gestionadaAt" IS NULL THEN 'SIN_GESTION' ELSE 'EN_GESTION' END) AS bad_states,
          (SELECT count(*)::int FROM "Garantia" g LEFT JOIN "EventoGarantia" e ON e."claveLegado"=g.id::text WHERE g."gestionadaAt" IS NOT NULL AND (e.id IS NULL OR e.tipo::text <> 'ANTECEDENTE_LEGADO' OR e."createdAt" IS DISTINCT FROM g."gestionadaAt" OR e."usuarioId" IS DISTINCT FROM g."gestionadaPorUsuarioId" OR e."tipoActuacion" IS NOT NULL OR e.comentario IS NOT NULL)) AS bad_legacy,
          (SELECT count(*)::int FROM "EventoGarantia") AS events`);
        requireCondition(invariants.bad_states === 0 && invariants.bad_legacy === 0 && invariants.events === legacy.count, "El backfill no coincide con el estado inicial esperado. Verificar antes de habilitar operaciones.");
      }
      return { identity, localMigrations: local.map(({ checksum: _checksum, ...entry }) => entry), pending, structures: { guaranteeColumns: columns.map((row) => row.column_name), eventTable: eventTable[0].present, enums: enums.map((row) => row.typname) }, snapshot: { database: TARGET, capturedAt: new Date().toISOString(), tables: fingerprints, legacyCount: legacy.count, migrationChecksum: migration.checksum } satisfies Snapshot };
    }, { timeout: 15000 });
    if (mode === "--before") fs.writeFileSync(path.resolve(snapshotFile!), JSON.stringify(result.snapshot, null, 2) + "\n", { flag: "wx" });
    if (mode === "--after") {
      const before = JSON.parse(fs.readFileSync(path.resolve(snapshotFile!), "utf8")) as Snapshot;
      requireCondition(before.database === TARGET && before.migrationChecksum === result.snapshot.migrationChecksum, "El snapshot no corresponde a QA o al mismo SQL de migración.");
      requireCondition(before.legacyCount === result.snapshot.legacyCount && tables.every((table) => before.tables[table]?.rows === result.snapshot.tables[table].rows && before.tables[table]?.fingerprint === result.snapshot.tables[table].fingerprint), "Cambió el contenido de tablas existentes. No iniciar operaciones; revisar la diferencia.");
    }
    console.info(JSON.stringify({ ok: true, mode, prismaVersion: Prisma.prismaVersion.client, database: result.identity.database, readOnly: result.identity.read_only, pending: result.pending, migrations: result.localMigrations, structures: result.structures, counts: Object.fromEntries(tables.map((table) => [table, result.snapshot.tables[table].rows])), legacyCount: result.snapshot.legacyCount, ...(mode === "--after" ? { priorRecordsPreserved: true } : {}) }, null, 2));
  } finally { await db.$disconnect(); }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, code: (error as { code?: string }).code ?? "QA_VERIFICATION_FAILED", message: error instanceof VerificationError ? error.message : "No se completó la verificación. Se omiten detalles para proteger credenciales y datos." }));
  process.exitCode = 1;
});
