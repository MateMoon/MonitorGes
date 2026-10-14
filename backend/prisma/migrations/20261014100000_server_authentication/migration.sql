ALTER TABLE "Usuario" ADD COLUMN "passwordHash" TEXT;

CREATE TABLE "SesionUsuario" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "usuarioId" UUID NOT NULL,
    "expiraAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SesionUsuario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SesionUsuario_tokenHash_key" ON "SesionUsuario"("tokenHash");
CREATE INDEX "SesionUsuario_usuarioId_expiraAt_idx" ON "SesionUsuario"("usuarioId", "expiraAt");
CREATE INDEX "SesionUsuario_expiraAt_idx" ON "SesionUsuario"("expiraAt");

ALTER TABLE "SesionUsuario" ADD CONSTRAINT "SesionUsuario_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
