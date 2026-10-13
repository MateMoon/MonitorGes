CREATE TYPE "EstadoEnvioCorreo" AS ENUM ('EN_PROCESO', 'ENVIADO', 'FALLIDO');

CREATE TABLE "EnvioInformeCorreo" (
    "id" UUID NOT NULL,
    "fechaInforme" DATE NOT NULL,
    "destinatario" TEXT NOT NULL,
    "estado" "EstadoEnvioCorreo" NOT NULL DEFAULT 'EN_PROCESO',
    "intentos" INTEGER NOT NULL DEFAULT 1,
    "iniciadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoAt" TIMESTAMP(3),
    "messageId" TEXT,
    "codigoError" TEXT,
    "operacionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvioInformeCorreo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EnvioInformeCorreo_fechaInforme_key" ON "EnvioInformeCorreo"("fechaInforme");
CREATE INDEX "EnvioInformeCorreo_estado_iniciadoAt_idx" ON "EnvioInformeCorreo"("estado", "iniciadoAt");

CREATE TABLE "IntentoEnvioCorreo" (
    "id" UUID NOT NULL,
    "envioId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "estado" "EstadoEnvioCorreo" NOT NULL DEFAULT 'EN_PROCESO',
    "iniciadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoAt" TIMESTAMP(3),
    "messageId" TEXT,
    "codigoError" TEXT,
    "operacionError" TEXT,

    CONSTRAINT "IntentoEnvioCorreo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IntentoEnvioCorreo_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "EnvioInformeCorreo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "IntentoEnvioCorreo_envioId_numero_key" ON "IntentoEnvioCorreo"("envioId", "numero");
CREATE INDEX "IntentoEnvioCorreo_envioId_iniciadoAt_idx" ON "IntentoEnvioCorreo"("envioId", "iniciadoAt");
