ALTER TABLE "Usuario" ADD COLUMN "reglasAsignacion" JSONB;

-- Preserve current access: every existing type applies to all problems and establishments.
UPDATE "Usuario" AS u
SET "reglasAsignacion" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'problemaSalud', '',
    'establecimiento', '',
    'tipoGarantia', t."claveNormalizada"
  ) ORDER BY t."claveNormalizada")
  FROM "UsuarioTipoGarantia" AS t WHERE t."usuarioId" = u."id"
), '[]'::jsonb);
