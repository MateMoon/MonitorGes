# API Monitor de Garantías GES

Backend independiente en Node.js, TypeScript, Fastify, Prisma y PostgreSQL. No conecta ni modifica los mocks del frontend.

## Requisitos

- Node.js 20.19+ (Fastify 5) y npm.
- PostgreSQL 14 o posterior, local o administrado.

## Instalación y configuración

Desde la carpeta `backend`:

```bash
npm install
cp .env.example .env
```

En Windows PowerShell, usa `Copy-Item .env.example .env`. Define `DATABASE_URL` con la conexión a PostgreSQL. `PORT` (predeterminado `3001`), `HOST` (predeterminado `0.0.0.0`) y `TIME_ZONE` (predeterminado `America/Santiago`) son opcionales. No guardes secretos en el repositorio; `.env` está excluido por el `.gitignore` de la raíz.

Levanta PostgreSQL con el método habitual en tu entorno y crea una base vacía llamada `monitor_garantias` (o ajusta el nombre en `DATABASE_URL`). Este proyecto no requiere Docker.

## Migraciones, seed e inicio

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run seed
npm run dev
```

Para un entorno ya migrado, usa `npm run prisma:deploy`. Los datos del seed son inventados e incluyen los cinco rangos de estado y pacientes con múltiples garantías. El seed limpia garantías, pacientes e importaciones existentes antes de insertar.

## Verificación

```bash
npm run typecheck
npm run build
npm test
```

Los tests de integración de rutas necesitan que `DATABASE_URL` apunte a una base disponible. Los tests de cálculo de fechas son puros.

## API disponible

- `GET /api/garantias`: lista paginada (`page`, `limit`, máximo 100), con filtros `rut`, `nombre`, `estado` (CSV o repetido), `responsable`, `problemaSalud`, `nombreGarantia`, `fechaLimiteDesde` y `fechaLimiteHasta`. Orden permitido: `fechaLimite`, `fechaInicio`, `nombreGarantia`, `responsable`, `createdAt`; `order=asc|desc`.
- `GET /api/garantias/:id`: detalle de garantía, paciente y gestión. UUID inválido produce 400; inexistente, 404.
- `GET /api/dashboard`: total, conteos por estado, hasta ocho garantías urgentes y última importación.
- `POST /api/importaciones/validar`: recibe un `.xlsx` en el campo multipart `archivo`, valida encabezados y filas, y devuelve resumen, hasta diez filas válidas de vista previa y errores. Límite de 10 MB; no guarda datos en PostgreSQL.
- `POST /api/importaciones`: vuelve a validar el archivo y persiste las filas válidas. Cada fila se procesa en una transacción que agrupa paciente, garantía, conteo y errores ambiguos; responde con el estado y los conteos finales.
- `GET /api/importaciones`: historial persistido con paginación (`page`, `limit`; máximo 100).

La coincidencia de garantía es provisional: RUT/DV normalizados + problema de salud + nombre de garantía + fecha de inicio. Fecha límite y responsable son actualizables. Si hay varias coincidencias, la fila se registra como ambigua y no se modifica. Esta clave no ha sido confirmada por FONASA y debe revisarse antes de usar datos reales. Las filas ausentes no eliminan garantías.

Las listas responden `{ data, pagination }`; el dashboard y detalle responden `{ data }`. Los errores usan `{ error: { code, message, details }, requestId }`. Días restantes y estado se calculan con la fecha civil del servidor en `TIME_ZONE` y nunca se persisten. Las fechas de la base son tipo SQL `DATE`.

La estructura separa rutas, controllers, services, repositories, schemas y acceso Prisma. La persistencia de garantías e importaciones ya está disponible. Autenticación y notificaciones siguen fuera de esta entrega.