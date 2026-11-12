-- Conserva todos los envíos e intentos; los anteriores pertenecen al ámbito diario.
-- Una ejecución programada nueva usa otra clave, sin reutilizar un envío aceptado.
BEGIN;
ALTER TABLE "EnvioInformeIndividual" ADD COLUMN "claveEjecucion" TEXT NOT NULL DEFAULT 'diario';
CREATE UNIQUE INDEX "EnvioInformeIndividual_usuario_fecha_ejecucion_key"
  ON "EnvioInformeIndividual"("usuarioId", "fechaInforme", "claveEjecucion");
-- Sustituye exclusivamente la restricción diaria; no elimina datos históricos.
DROP INDEX "EnvioInformeIndividual_usuarioId_fechaInforme_key";
COMMIT;
