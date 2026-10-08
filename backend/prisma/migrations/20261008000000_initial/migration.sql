CREATE TYPE "RolUsuario" AS ENUM ('ADMIN', 'PROFESIONAL', 'LECTOR');
CREATE TYPE "EstadoImportacion" AS ENUM ('COMPLETADA', 'COMPLETADA_CON_OBSERVACIONES', 'FALLIDA');

CREATE TABLE "Paciente" (
  "id" UUID NOT NULL,
  "rutNumero" TEXT NOT NULL,
  "dv" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Paciente_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Usuario" (
  "id" UUID NOT NULL,
  "nombre" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "rol" "RolUsuario" NOT NULL DEFAULT 'LECTOR',
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "ultimoAccesoAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Garantia" (
  "id" UUID NOT NULL,
  "pacienteId" UUID NOT NULL,
  "problemaSalud" TEXT NOT NULL,
  "nombreGarantia" TEXT NOT NULL,
  "fechaInicio" DATE NOT NULL,
  "fechaLimite" DATE NOT NULL,
  "responsable" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "gestionadaAt" TIMESTAMP(3),
  "gestionadaPorUsuarioId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "Garantia_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Importacion" (
  "id" UUID NOT NULL,
  "nombreArchivo" TEXT NOT NULL,
  "fechaImportacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usuarioId" UUID,
  "estado" "EstadoImportacion" NOT NULL,
  "registrosLeidos" INTEGER NOT NULL DEFAULT 0,
  "registrosNuevos" INTEGER NOT NULL DEFAULT 0,
  "registrosActualizados" INTEGER NOT NULL DEFAULT 0,
  "registrosSinCambios" INTEGER NOT NULL DEFAULT 0,
  "registrosConError" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Importacion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ErrorImportacion" (
  "id" UUID NOT NULL,
  "importacionId" UUID NOT NULL,
  "numeroFila" INTEGER NOT NULL,
  "codigo" TEXT NOT NULL,
  "mensaje" TEXT NOT NULL,
  "datosFila" JSONB,
  CONSTRAINT "ErrorImportacion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Paciente_rutNumero_dv_key" ON "Paciente"("rutNumero", "dv");
CREATE UNIQUE INDEX "Usuario_username_key" ON "Usuario"("username");
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");
CREATE INDEX "Garantia_fechaLimite_idx" ON "Garantia"("fechaLimite");
CREATE INDEX "Garantia_responsable_idx" ON "Garantia"("responsable");
CREATE INDEX "Garantia_pacienteId_idx" ON "Garantia"("pacienteId");
CREATE INDEX "Importacion_fechaImportacion_idx" ON "Importacion"("fechaImportacion");
CREATE INDEX "ErrorImportacion_importacionId_numeroFila_idx" ON "ErrorImportacion"("importacionId", "numeroFila");
ALTER TABLE "Garantia" ADD CONSTRAINT "Garantia_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Garantia" ADD CONSTRAINT "Garantia_gestionadaPorUsuarioId_fkey" FOREIGN KEY ("gestionadaPorUsuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Importacion" ADD CONSTRAINT "Importacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ErrorImportacion" ADD CONSTRAINT "ErrorImportacion_importacionId_fkey" FOREIGN KEY ("importacionId") REFERENCES "Importacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
