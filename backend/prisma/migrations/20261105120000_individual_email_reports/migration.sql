-- Historial individual independiente. No altera reservas, intentos ni destinatarios globales anteriores.
CREATE TYPE "EstadoInformeIndividual" AS ENUM ('RESERVADO', 'EN_PROCESO', 'ACEPTADO_SMTP', 'FALLIDO', 'OMITIDO', 'INCIERTO');

CREATE TABLE "EnvioInformeIndividual" (
  "id" UUID NOT NULL,
  "usuarioId" UUID NOT NULL,
  "fechaInforme" DATE NOT NULL,
  "destinatario" TEXT NOT NULL,
  "huellaConfiguracion" TEXT NOT NULL,
  "tokenReserva" UUID NOT NULL,
  "estado" "EstadoInformeIndividual" NOT NULL DEFAULT 'RESERVADO',
  "intentos" INTEGER NOT NULL DEFAULT 1,
  "iniciadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizadoAt" TIMESTAMP(3),
  "aceptadoSmtpAt" TIMESTAMP(3),
  "cantidadGarantias" INTEGER NOT NULL DEFAULT 0,
  "codigoResultado" TEXT,
  "reintentable" BOOLEAN NOT NULL DEFAULT false,
  "messageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EnvioInformeIndividual_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EnvioInformeIndividual_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EnvioInformeIndividual_usuarioId_fechaInforme_key" ON "EnvioInformeIndividual"("usuarioId", "fechaInforme");
CREATE INDEX "EnvioInformeIndividual_fechaInforme_estado_idx" ON "EnvioInformeIndividual"("fechaInforme", "estado");

CREATE TABLE "IntentoInformeIndividual" (
  "id" UUID NOT NULL,
  "envioId" UUID NOT NULL,
  "numero" INTEGER NOT NULL,
  "estado" "EstadoInformeIndividual" NOT NULL DEFAULT 'RESERVADO',
  "iniciadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizadoAt" TIMESTAMP(3),
  "aceptadoSmtpAt" TIMESTAMP(3),
  "cantidadGarantias" INTEGER NOT NULL DEFAULT 0,
  "codigoResultado" TEXT,
  "reintentable" BOOLEAN NOT NULL DEFAULT false,
  "messageId" TEXT,
  CONSTRAINT "IntentoInformeIndividual_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntentoInformeIndividual_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "EnvioInformeIndividual"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IntentoInformeIndividual_envioId_numero_key" ON "IntentoInformeIndividual"("envioId", "numero");
