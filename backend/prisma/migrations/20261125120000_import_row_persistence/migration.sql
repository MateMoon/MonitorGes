-- CreateEnum
CREATE TYPE "EstadoFilaImportacion" AS ENUM ('PENDIENTE', 'RESUELTA');

-- CreateEnum
CREATE TYPE "DecisionFilaImportacion" AS ENUM ('MISMA', 'DISTINTA');

-- CreateTable
CREATE TABLE "FilaImportacion" (
    "id" UUID NOT NULL,
    "importacionId" UUID NOT NULL,
    "hoja" VARCHAR(255) NOT NULL,
    "numeroFila" INTEGER NOT NULL,
    "datosValidados" JSONB NOT NULL,
    "motivos" TEXT[],
    "versionPolitica" VARCHAR(64) NOT NULL,
    "estado" "EstadoFilaImportacion" NOT NULL DEFAULT 'PENDIENTE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "huellaFila" VARCHAR(64) NOT NULL,
    "huellaDatos" VARCHAR(64) NOT NULL,
    "huellaCandidatos" VARCHAR(64) NOT NULL,
    "garantiaResultadoId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilaImportacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidatoFilaImportacion" (
    "filaId" UUID NOT NULL,
    "garantiaId" UUID NOT NULL,
    "datos" JSONB NOT NULL,
    "huella" VARCHAR(64) NOT NULL,
    "versionGarantia" INTEGER NOT NULL,
    "revisionGestion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidatoFilaImportacion_pkey" PRIMARY KEY ("filaId","garantiaId")
);

-- CreateTable
CREATE TABLE "ResolucionFilaImportacion" (
    "id" UUID NOT NULL,
    "filaId" UUID NOT NULL,
    "decision" "DecisionFilaImportacion" NOT NULL,
    "usuarioId" UUID NOT NULL,
    "autorNombre" TEXT NOT NULL,
    "justificacion" TEXT NOT NULL,
    "solicitudId" UUID NOT NULL,
    "huellaSolicitud" VARCHAR(64) NOT NULL,
    "garantiaResultadoId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResolucionFilaImportacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FilaImportacion_estado_createdAt_id_idx" ON "FilaImportacion"("estado", "createdAt", "id");

-- CreateIndex
CREATE INDEX "FilaImportacion_garantiaResultadoId_idx" ON "FilaImportacion"("garantiaResultadoId");

-- CreateIndex
CREATE UNIQUE INDEX "FilaImportacion_origen_key" ON "FilaImportacion"("importacionId", "hoja", "numeroFila");

-- CreateIndex
CREATE UNIQUE INDEX "FilaImportacion_resultado_key" ON "FilaImportacion"("id", "garantiaResultadoId");

-- CreateIndex
CREATE INDEX "CandidatoFilaImportacion_garantiaId_idx" ON "CandidatoFilaImportacion"("garantiaId");

-- CreateIndex
CREATE UNIQUE INDEX "ResolucionFilaImportacion_filaId_key" ON "ResolucionFilaImportacion"("filaId");

-- CreateIndex
CREATE UNIQUE INDEX "ResolucionFilaImportacion_solicitudId_key" ON "ResolucionFilaImportacion"("solicitudId");

-- CreateIndex
CREATE INDEX "ResolucionFilaImportacion_createdAt_id_idx" ON "ResolucionFilaImportacion"("createdAt", "id");

-- CreateIndex
CREATE INDEX "ResolucionFilaImportacion_garantiaResultadoId_idx" ON "ResolucionFilaImportacion"("garantiaResultadoId");

-- CreateIndex
CREATE UNIQUE INDEX "ResolucionFilaImportacion_resultado_key" ON "ResolucionFilaImportacion"("filaId", "garantiaResultadoId");

-- AddForeignKey
ALTER TABLE "FilaImportacion" ADD CONSTRAINT "FilaImportacion_importacionId_fkey" FOREIGN KEY ("importacionId") REFERENCES "Importacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilaImportacion" ADD CONSTRAINT "FilaImportacion_garantiaResultadoId_fkey" FOREIGN KEY ("garantiaResultadoId") REFERENCES "Garantia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatoFilaImportacion" ADD CONSTRAINT "CandidatoFilaImportacion_filaId_fkey" FOREIGN KEY ("filaId") REFERENCES "FilaImportacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatoFilaImportacion" ADD CONSTRAINT "CandidatoFilaImportacion_garantiaId_fkey" FOREIGN KEY ("garantiaId") REFERENCES "Garantia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolucionFilaImportacion" ADD CONSTRAINT "ResolucionFilaImportacion_filaId_garantiaResultadoId_fkey" FOREIGN KEY ("filaId", "garantiaResultadoId") REFERENCES "FilaImportacion"("id", "garantiaResultadoId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ResolucionFilaImportacion" ADD CONSTRAINT "ResolucionFilaImportacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolucionFilaImportacion" ADD CONSTRAINT "ResolucionFilaImportacion_garantiaResultadoId_fkey" FOREIGN KEY ("garantiaResultadoId") REFERENCES "Garantia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain constraints affect only the new tables.
ALTER TABLE "FilaImportacion"
    ADD CONSTRAINT "FilaImportacion_numeroFila_check" CHECK ("numeroFila" > 0),
    ADD CONSTRAINT "FilaImportacion_version_check" CHECK ("version" > 0),
    ADD CONSTRAINT "FilaImportacion_hoja_check" CHECK (length(btrim("hoja")) > 0),
    ADD CONSTRAINT "FilaImportacion_datos_check" CHECK (jsonb_typeof("datosValidados") = 'object'),
    ADD CONSTRAINT "FilaImportacion_motivos_check" CHECK ("motivos" IS NOT NULL AND cardinality("motivos") > 0 AND array_position("motivos", NULL) IS NULL),
    ADD CONSTRAINT "FilaImportacion_resultado_estado_check" CHECK (
        ("estado" = 'PENDIENTE' AND "garantiaResultadoId" IS NULL)
        OR ("estado" = 'RESUELTA' AND "garantiaResultadoId" IS NOT NULL)
    );
ALTER TABLE "CandidatoFilaImportacion"
    ADD CONSTRAINT "CandidatoFilaImportacion_version_check" CHECK ("versionGarantia" > 0 AND "revisionGestion" >= 0),
    ADD CONSTRAINT "CandidatoFilaImportacion_datos_check" CHECK (jsonb_typeof("datos") = 'object');
ALTER TABLE "ResolucionFilaImportacion"
    ADD CONSTRAINT "ResolucionFilaImportacion_justificacion_check" CHECK (length(btrim("justificacion")) BETWEEN 5 AND 4000);

-- Terminal audit records are append-only, including for future application code.
CREATE FUNCTION "preserve_import_row_resolution"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Import row resolutions are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "ResolucionFilaImportacion_immutable"
BEFORE UPDATE OR DELETE ON "ResolucionFilaImportacion"
FOR EACH ROW EXECUTE FUNCTION "preserve_import_row_resolution"();
