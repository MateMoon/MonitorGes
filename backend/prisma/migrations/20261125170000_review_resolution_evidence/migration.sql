-- AlterTable
ALTER TABLE "ResolucionFilaImportacion" ADD COLUMN     "antecedentesRevisados" JSONB;

-- Historical decisions retain NULL; new operational decisions capture the
-- reviewed candidate set. No backfill or change to immutable audit records.
ALTER TABLE "ResolucionFilaImportacion"
    ADD CONSTRAINT "ResolucionFilaImportacion_antecedentes_check"
    CHECK ("antecedentesRevisados" IS NULL OR jsonb_typeof("antecedentesRevisados") = 'object');
