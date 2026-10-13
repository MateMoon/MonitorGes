CREATE TABLE "ConfiguracionNotificaciones" (
    "id" TEXT NOT NULL,
    "emailDestinatario" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionNotificaciones_pkey" PRIMARY KEY ("id")
);
