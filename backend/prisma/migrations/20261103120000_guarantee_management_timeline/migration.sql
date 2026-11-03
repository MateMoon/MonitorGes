BEGIN;

CREATE TYPE "EstadoGestion" AS ENUM ('SIN_GESTION', 'EN_GESTION', 'PENDIENTE_RESOLUCION', 'CUMPLIDA');
CREATE TYPE "TipoActuacion" AS ENUM ('CONTACTO_PACIENTE', 'CITACION', 'ATENCION_REALIZADA', 'DERIVACION', 'SOLICITUD_RESPALDO', 'OTRA_GESTION');
CREATE TYPE "TipoEventoGarantia" AS ENUM ('ACTUACION', 'CAMBIO_ESTADO', 'CUMPLIMIENTO', 'REAPERTURA', 'ANTECEDENTE_LEGADO');

ALTER TABLE "Garantia"
  ADD COLUMN "estadoGestion" "EstadoGestion" NOT NULL DEFAULT 'SIN_GESTION',
  ADD COLUMN "revisionGestion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "EventoGarantia" (
  "id" UUID NOT NULL,
  "secuencia" SERIAL NOT NULL,
  "garantiaId" UUID NOT NULL,
  "usuarioId" UUID,
  "autorNombre" TEXT,
  "tipo" "TipoEventoGarantia" NOT NULL,
  "tipoActuacion" "TipoActuacion",
  "comentario" TEXT,
  "estadoAnterior" "EstadoGestion",
  "estadoNuevo" "EstadoGestion",
  "respaldo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadatos" JSONB,
  "claveLegado" TEXT,
  CONSTRAINT "EventoGarantia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventoGarantia_garantiaId_fkey" FOREIGN KEY ("garantiaId") REFERENCES "Garantia"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EventoGarantia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "EventoGarantia_cumplimiento_respaldo_check" CHECK ("tipo" <> 'CUMPLIMIENTO' OR ("respaldo" IS NOT NULL AND btrim("respaldo") <> '')),
  CONSTRAINT "EventoGarantia_reapertura_motivo_check" CHECK ("tipo" <> 'REAPERTURA' OR ("comentario" IS NOT NULL AND btrim("comentario") <> '')),
  CONSTRAINT "EventoGarantia_actuacion_tipo_check" CHECK ("tipo" <> 'ACTUACION' OR "tipoActuacion" IS NOT NULL)
);
CREATE UNIQUE INDEX "EventoGarantia_secuencia_key" ON "EventoGarantia"("secuencia");
CREATE UNIQUE INDEX "EventoGarantia_claveLegado_key" ON "EventoGarantia"("claveLegado");
CREATE INDEX "EventoGarantia_garantiaId_createdAt_secuencia_idx" ON "EventoGarantia"("garantiaId", "createdAt", "secuencia");
CREATE INDEX "Garantia_estadoGestion_fechaLimite_idx" ON "Garantia"("estadoGestion", "fechaLimite");

-- Conserva el antecedente conocido: fecha y autor, sin inventar actuación o comentario.
-- ID y clave deterministas impiden duplicar este antecedente.
INSERT INTO "EventoGarantia" ("id", "garantiaId", "usuarioId", "autorNombre", "tipo", "createdAt", "claveLegado")
SELECT md5('gestion-legada:' || g."id"::text)::uuid, g."id", g."gestionadaPorUsuarioId", u."nombre",
       'ANTECEDENTE_LEGADO', g."gestionadaAt", g."id"::text
FROM "Garantia" g LEFT JOIN "Usuario" u ON u."id" = g."gestionadaPorUsuarioId"
WHERE g."gestionadaAt" IS NOT NULL
ON CONFLICT ("claveLegado") DO NOTHING;

UPDATE "Garantia" SET "estadoGestion" = 'EN_GESTION' WHERE "gestionadaAt" IS NOT NULL;
-- No modifica fechas de plazo, versión de importación ni campos de última gestión.
COMMIT;
