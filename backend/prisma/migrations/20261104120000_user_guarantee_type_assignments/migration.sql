-- Los nombres completos existentes se conservan literalmente. El administrador
-- podrá completar los campos separados sin inferir apellidos durante la migración.
ALTER TABLE "Usuario"
  ADD COLUMN "nombres" TEXT,
  ADD COLUMN "apellido" TEXT,
  ADD COLUMN "recibirInformeAutomatico" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "NombreGarantiaAsignable" (
  "claveNormalizada" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  CONSTRAINT "NombreGarantiaAsignable_pkey" PRIMARY KEY ("claveNormalizada")
);

CREATE TABLE "UsuarioTipoGarantia" (
  "usuarioId" UUID NOT NULL,
  "claveNormalizada" TEXT NOT NULL,
  CONSTRAINT "UsuarioTipoGarantia_pkey" PRIMARY KEY ("usuarioId", "claveNormalizada"),
  CONSTRAINT "UsuarioTipoGarantia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsuarioTipoGarantia_claveNormalizada_fkey" FOREIGN KEY ("claveNormalizada") REFERENCES "NombreGarantiaAsignable"("claveNormalizada") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "UsuarioTipoGarantia_claveNormalizada_idx" ON "UsuarioTipoGarantia"("claveNormalizada");
