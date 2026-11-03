CREATE TABLE "Establecimiento" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "claveNormalizada" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Establecimiento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemaSalud" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "claveNormalizada" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProblemaSalud_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TipoGarantia" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "claveNormalizada" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TipoGarantia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CombinacionProblemaGarantia" (
    "id" UUID NOT NULL,
    "problemaSaludId" UUID NOT NULL,
    "tipoGarantiaId" UUID NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CombinacionProblemaGarantia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AreaResponsabilidad" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "combinacionId" UUID NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creadorId" UUID,
    "actualizadorId" UUID,
    CONSTRAINT "AreaResponsabilidad_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Establecimiento_nombre_key" ON "Establecimiento"("nombre");
CREATE INDEX "Establecimiento_activo_nombre_idx" ON "Establecimiento"("activo", "nombre");
CREATE INDEX "Establecimiento_claveNormalizada_idx" ON "Establecimiento"("claveNormalizada");
CREATE UNIQUE INDEX "ProblemaSalud_nombre_key" ON "ProblemaSalud"("nombre");
CREATE INDEX "ProblemaSalud_activo_nombre_idx" ON "ProblemaSalud"("activo", "nombre");
CREATE INDEX "ProblemaSalud_claveNormalizada_idx" ON "ProblemaSalud"("claveNormalizada");
CREATE UNIQUE INDEX "TipoGarantia_nombre_key" ON "TipoGarantia"("nombre");
CREATE INDEX "TipoGarantia_activo_nombre_idx" ON "TipoGarantia"("activo", "nombre");
CREATE INDEX "TipoGarantia_claveNormalizada_idx" ON "TipoGarantia"("claveNormalizada");
CREATE UNIQUE INDEX "CombinacionProblemaGarantia_pair_key"
    ON "CombinacionProblemaGarantia"("problemaSaludId", "tipoGarantiaId");
CREATE INDEX "CombinacionProblemaGarantia_activa_idx" ON "CombinacionProblemaGarantia"("activa");
CREATE UNIQUE INDEX "AreaResponsabilidad_coverage_key"
    ON "AreaResponsabilidad"("usuarioId", "establecimientoId", "combinacionId");
CREATE INDEX "AreaResponsabilidad_usuarioId_activa_idx" ON "AreaResponsabilidad"("usuarioId", "activa");
CREATE INDEX "AreaResponsabilidad_scope_idx"
    ON "AreaResponsabilidad"("establecimientoId", "combinacionId", "activa");

ALTER TABLE "CombinacionProblemaGarantia"
    ADD CONSTRAINT "CombinacionProblemaGarantia_problemaSaludId_fkey"
    FOREIGN KEY ("problemaSaludId") REFERENCES "ProblemaSalud"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinacionProblemaGarantia"
    ADD CONSTRAINT "CombinacionProblemaGarantia_tipoGarantiaId_fkey"
    FOREIGN KEY ("tipoGarantiaId") REFERENCES "TipoGarantia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AreaResponsabilidad"
    ADD CONSTRAINT "AreaResponsabilidad_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AreaResponsabilidad"
    ADD CONSTRAINT "AreaResponsabilidad_establecimientoId_fkey"
    FOREIGN KEY ("establecimientoId") REFERENCES "Establecimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AreaResponsabilidad"
    ADD CONSTRAINT "AreaResponsabilidad_combinacionId_fkey"
    FOREIGN KEY ("combinacionId") REFERENCES "CombinacionProblemaGarantia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AreaResponsabilidad"
    ADD CONSTRAINT "AreaResponsabilidad_creadorId_fkey"
    FOREIGN KEY ("creadorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AreaResponsabilidad"
    ADD CONSTRAINT "AreaResponsabilidad_actualizadorId_fkey"
    FOREIGN KEY ("actualizadorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bootstrap catalogs from the exact category values already stored in this database.
-- This does not rewrite or delete any guarantee rows and does not infer establishments.
INSERT INTO "ProblemaSalud" ("id", "nombre", "claveNormalizada", "createdAt", "updatedAt")
SELECT gen_random_uuid(), source."problemaSalud",
       regexp_replace(lower(translate(btrim(source."problemaSalud"), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', ' ', 'g'),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "problemaSalud" FROM "Garantia" WHERE btrim("problemaSalud") <> '') source;

INSERT INTO "TipoGarantia" ("id", "nombre", "claveNormalizada", "createdAt", "updatedAt")
SELECT gen_random_uuid(), source."nombreGarantia",
       regexp_replace(lower(translate(btrim(source."nombreGarantia"), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', ' ', 'g'),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "nombreGarantia" FROM "Garantia" WHERE btrim("nombreGarantia") <> '') source;

INSERT INTO "CombinacionProblemaGarantia" ("id", "problemaSaludId", "tipoGarantiaId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), problem."id", guarantee_type."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "problemaSalud", "nombreGarantia" FROM "Garantia") source
JOIN "ProblemaSalud" problem ON problem."nombre" = source."problemaSalud"
JOIN "TipoGarantia" guarantee_type ON guarantee_type."nombre" = source."nombreGarantia";
