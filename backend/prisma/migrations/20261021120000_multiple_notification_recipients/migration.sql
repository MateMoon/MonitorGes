-- Add a recipient list while retaining the legacy scalar column for rolling compatibility.
ALTER TABLE "ConfiguracionNotificaciones"
ADD COLUMN "emailDestinatarios" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Preserve the configured single recipient in the new list.
UPDATE "ConfiguracionNotificaciones"
SET "emailDestinatarios" = ARRAY["emailDestinatario"]::TEXT[]
WHERE "emailDestinatario" IS NOT NULL AND btrim("emailDestinatario") <> '';