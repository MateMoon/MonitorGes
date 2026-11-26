-- CreateEnum
CREATE TYPE "EstadoCasoCalidad" AS ENUM ('PENDIENTE', 'ANTECEDENTES', 'RESUELTO');

-- CreateEnum
CREATE TYPE "OrigenCasoCalidad" AS ENUM ('APLICACION', 'EXCEL');

-- CreateEnum
CREATE TYPE "DecisionCalidad" AS ENUM ('MISMA_GARANTIA', 'GARANTIAS_DIFERENTES', 'NECESITA_ANTECEDENTES', 'FILA_INCORRECTA');

-- CreateEnum
CREATE TYPE "TipoEventoCalidad" AS ENUM ('DETECCION', 'REUTILIZACION', 'SOLICITUD_ANTECEDENTES', 'DECISION');

-- CreateTable
CREATE TABLE "CasoCalidad" (
    "id" UUID NOT NULL,
    "origen" "OrigenCasoCalidad" NOT NULL,
    "motivo" TEXT NOT NULL,
    "estado" "EstadoCasoCalidad" NOT NULL DEFAULT 'PENDIENTE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "huella" VARCHAR(64) NOT NULL,
    "claveAbierta" VARCHAR(64),
    "nombreArchivo" VARCHAR(255),
    "huellaArchivo" VARCHAR(64),
    "numeroFila" INTEGER,
    "diferencias" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creadoPorId" UUID NOT NULL,
    "detectadoAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasoCalidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenciaCalidad" (
    "id" UUID NOT NULL,
    "casoId" UUID NOT NULL,
    "posicion" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "garantiaId" UUID,
    "datos" JSONB NOT NULL,
    "huella" VARCHAR(64) NOT NULL,
    "versionGarantia" INTEGER,
    "revisionGestion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenciaCalidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoCalidad" (
    "id" UUID NOT NULL,
    "secuencia" SERIAL NOT NULL,
    "casoId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "autorNombre" TEXT NOT NULL,
    "tipo" "TipoEventoCalidad" NOT NULL,
    "decision" "DecisionCalidad",
    "estadoAnterior" "EstadoCasoCalidad",
    "estadoNuevo" "EstadoCasoCalidad" NOT NULL,
    "justificacion" TEXT,
    "antecedentes" TEXT,
    "observacion" TEXT,
    "solicitudId" UUID NOT NULL,
    "huellaSolicitud" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoCalidad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CasoCalidad_claveAbierta_key" ON "CasoCalidad"("claveAbierta");

-- CreateIndex
CREATE INDEX "CasoCalidad_estado_createdAt_id_idx" ON "CasoCalidad"("estado", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CasoCalidad_origen_motivo_idx" ON "CasoCalidad"("origen", "motivo");

-- CreateIndex
CREATE INDEX "EvidenciaCalidad_garantiaId_idx" ON "EvidenciaCalidad"("garantiaId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenciaCalidad_casoId_posicion_key" ON "EvidenciaCalidad"("casoId", "posicion");

-- CreateIndex
CREATE UNIQUE INDEX "EventoCalidad_secuencia_key" ON "EventoCalidad"("secuencia");

-- CreateIndex
CREATE UNIQUE INDEX "EventoCalidad_solicitudId_key" ON "EventoCalidad"("solicitudId");

-- CreateIndex
CREATE INDEX "EventoCalidad_casoId_createdAt_secuencia_idx" ON "EventoCalidad"("casoId", "createdAt", "secuencia");

-- AddForeignKey
ALTER TABLE "CasoCalidad" ADD CONSTRAINT "CasoCalidad_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaCalidad" ADD CONSTRAINT "EvidenciaCalidad_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "CasoCalidad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaCalidad" ADD CONSTRAINT "EvidenciaCalidad_garantiaId_fkey" FOREIGN KEY ("garantiaId") REFERENCES "Garantia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoCalidad" ADD CONSTRAINT "EventoCalidad_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "CasoCalidad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoCalidad" ADD CONSTRAINT "EventoCalidad_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
