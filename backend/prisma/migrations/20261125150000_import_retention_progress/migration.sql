-- CreateTable
CREATE TABLE "ControlRetencionImportacion" (
    "importacionId" UUID NOT NULL,
    "solicitudId" UUID NOT NULL,
    "huellaArchivo" VARCHAR(64) NOT NULL,
    "versionPolitica" VARCHAR(64) NOT NULL,
    "registrosPendientesRevision" INTEGER NOT NULL DEFAULT 0,
    "registrosRepetidosOmitidos" INTEGER NOT NULL DEFAULT 0,
    "registrosInvalidos" INTEGER NOT NULL DEFAULT 0,
    "resultados" JSONB NOT NULL DEFAULT '{}',
    "completada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlRetencionImportacion_pkey" PRIMARY KEY ("importacionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ControlRetencionImportacion_solicitudId_key" ON "ControlRetencionImportacion"("solicitudId");

-- AddForeignKey
ALTER TABLE "ControlRetencionImportacion" ADD CONSTRAINT "ControlRetencionImportacion_importacionId_fkey" FOREIGN KEY ("importacionId") REFERENCES "Importacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ControlRetencionImportacion"
    ADD CONSTRAINT "ControlRetencionImportacion_contadores_check" CHECK (
        "registrosPendientesRevision" >= 0 AND "registrosRepetidosOmitidos" >= 0 AND "registrosInvalidos" >= 0
    ),
    ADD CONSTRAINT "ControlRetencionImportacion_resultados_check" CHECK (jsonb_typeof("resultados") = 'object');
