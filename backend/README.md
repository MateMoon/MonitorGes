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

- GET /api/notificaciones/configuracion-correo: requiere sesion valida. PUT /api/notificaciones/configuracion-correo: requiere sesion valida y rol ADMIN.
- `GET /api/garantias`: lista paginada (`page`, `limit`, máximo 100), con filtros `rut`, `nombre`, `estado` (CSV o repetido), `responsable`, `problemaSalud`, `nombreGarantia`, `fechaLimiteDesde` y `fechaLimiteHasta`. Orden permitido: `fechaLimite`, `fechaInicio`, `nombreGarantia`, `responsable`, `createdAt`; `order=asc|desc`.
- `GET /api/garantias/:id`: detalle de garantía, paciente y gestión. UUID inválido produce 400; inexistente, 404.
- `GET /api/dashboard`: total, conteos por estado, hasta ocho garantías urgentes y última importación.
- `POST /api/importaciones/validar`: recibe un `.xlsx` en el campo multipart `archivo`, valida encabezados y filas, y devuelve resumen, hasta diez filas válidas de vista previa y errores. Límite de 10 MB; no guarda datos en PostgreSQL.
- `POST /api/importaciones`: vuelve a validar el archivo y persiste las filas válidas. Cada fila se procesa en una transacción que agrupa paciente, garantía, conteo y errores ambiguos; responde con el estado y los conteos finales.
- `GET /api/importaciones`: historial persistido con paginación (`page`, `limit`; máximo 100).

La coincidencia de garantía es provisional: RUT/DV normalizados + problema de salud + nombre de garantía + fecha de inicio. Fecha límite y responsable son actualizables. Si hay varias coincidencias, la fila se registra como ambigua y no se modifica. Esta clave no ha sido confirmada por FONASA y debe revisarse antes de usar datos reales. Las filas ausentes no eliminan garantías.

Las listas responden `{ data, pagination }`; el dashboard y detalle responden `{ data }`. Los errores usan `{ error: { code, message, details }, requestId }`. Días restantes y estado se calculan con la fecha civil del servidor en `TIME_ZONE` y nunca se persisten. Las fechas de la base son tipo SQL `DATE`.

La estructura separa rutas, controllers, services, repositories, schemas y acceso Prisma. La persistencia de garantías e importaciones está disponible. El servicio SMTP se reutiliza tanto para la prueba manual como para el programador de informes; Alertas administra el destinatario operativo persistido.

## Prueba manual SMTP

Configura estas variables en `backend/.env` (el archivo `.env` existente no se sobrescribe; agrega las líneas manualmente):

| Variable | Uso |
| --- | --- |
| `SMTP_HOST` | Nombre del servidor SMTP entregado por el proveedor o el equipo de TI. |
| `SMTP_PORT` | Puerto SMTP. Usa el valor indicado por el proveedor. |
| `SMTP_SECURE` | `true` si la conexión usa TLS implícito (habitualmente puerto 465); `false` si negocia STARTTLS (habitualmente puerto 587). Sigue la configuración institucional. |
| `SMTP_USER` | Usuario SMTP. |
| `SMTP_PASS` | Contraseña o clave SMTP. Mantén este valor fuera del repositorio. |
| `EMAIL_FROM` | Dirección y, opcionalmente, nombre remitente autorizado por el proveedor. |
| `EMAIL_TEST_TO` | Único destinatario que usará el script de prueba. |

El archivo `.env.example` muestra los nombres y un ejemplo habitual de puerto/seguridad, sin incluir credenciales. Solicita al administrador de correo el host, puerto, TLS, método de autenticación y remitente permitidos por la institución; las cuentas institucionales pueden exigir contraseña de aplicación o SMTP AUTH habilitado.

Desde la carpeta `backend`, ejecuta:

```bash
npm run email:test
```

El script carga `.env`, valida todas las variables, verifica la conexión SMTP y envía un mensaje sin datos personales únicamente a `EMAIL_TEST_TO`. No acepta destinatarios por argumento ni crea un endpoint HTTP. Un mensaje de éxito confirma que el transporte SMTP aceptó la solicitud de envío; no confirma que el mensaje llegó a la bandeja de entrada. El `messageId` se muestra cuando el servidor lo devuelve.

Diagnósticos habituales:

- Variables ausentes o puerto/formato inválido: revisa `.env` y compara los nombres con `.env.example`.
- `ETIMEDOUT`, `ECONNECTION` o `ESOCKET`: revisa host, puerto, TLS/STARTTLS, DNS, firewall y acceso de salida a SMTP.
- `EAUTH` o respuesta SMTP 535: revisa usuario/clave, SMTP AUTH y si el proveedor exige una clave de aplicación.
- Rechazo del remitente o destinatario: confirma que `EMAIL_FROM` esté autorizado y que `EMAIL_TEST_TO` pueda recibir mensajes desde esa cuenta.

El script muestra códigos/operaciones de transporte cuando están disponibles, pero omite el texto crudo de errores para evitar exponer credenciales u otros datos sensibles. Nunca imprime la contraseña.


## Configuración del destinatario desde Alertas

La interfaz consulta y actualiza `GET /api/notificaciones/configuracion-correo` y `PUT /api/notificaciones/configuracion-correo` con `{ "email": "qa@example.test" }`. La dirección se valida, normaliza en minúsculas y persiste en la fila singleton `ConfiguracionNotificaciones` (`id=global`). No hay inicialización desde `EMAIL_REPORT_TO`: al instalar la migración el destinatario queda vacío, y el programador no envía nada hasta que exista una dirección válida guardada. Guardar no envía un correo.

La autenticacion de servidor se describe en la seccion siguiente. Las rutas privadas ya exigen una sesion y los permisos se validan en Fastify.

La reserva del informe es única por fecha `America/Santiago` y guarda el destinatario utilizado. El destinatario se lee de PostgreSQL al iniciar cada ejecución y queda fijado en la reserva. Si se cambia la dirección después de que ese día ya se reservó un informe, no se manda un segundo correo a la nueva dirección ese mismo día. Si el intento anterior falló y el destinatario no cambió, se reintenta cada cinco minutos; si cambió, los reintentos del día se detienen y la nueva dirección se usa desde la próxima fecha programada. Si el campo está vacío, la ejecución se omite y el programador vuelve a comprobarlo en cinco minutos. Así el cambio desde Alertas no dispara envíos accidentales.

`fechaLimite` es una columna SQL `DATE NOT NULL`, por lo que no admite nulos; PostgreSQL valida la fecha almacenada. Filas con fecha nula o inválida no se pueden insertar en el esquema vigente. El cálculo del estado usa la fecha civil local y no la columna importada de días restantes.

### Preparar una base QA sin tocar la base actual

Primero crea en PostgreSQL una base separada, por ejemplo `monitor_garantias_qa`, y usa credenciales QA. En una consola PowerShell nueva, asigna la conexión QA solo a esa sesión (no reutilices `DATABASE_URL` de producción/desarrollo):

```powershell
$qaDatabaseUrl = Read-Host "DATABASE_URL de la base QA (debe terminar en /monitor_garantias_qa?schema=public)"
if ($qaDatabaseUrl -notmatch '/monitor_garantias_qa(?:\?|$)') { throw "La URL no identifica la base monitor_garantias_qa; no se ejecutó ningún comando." }
$env:DATABASE_URL = $qaDatabaseUrl
try {
  npm.cmd run prisma:deploy
  if ($LASTEXITCODE -ne 0) { throw "prisma:deploy falló ($LASTEXITCODE)" }
  npm.cmd run prisma:generate
  if ($LASTEXITCODE -ne 0) { throw "prisma:generate falló ($LASTEXITCODE)" }
  npm.cmd run seed
  if ($LASTEXITCODE -ne 0) { throw "seed falló ($LASTEXITCODE)" }
} finally {
  Remove-Item Env:DATABASE_URL
}
```

Verifica la base y el nombre `monitor_garantias_qa` antes de ejecutar `prisma:deploy` y `seed`: `seed` elimina garantías, pacientes e importaciones de la base a la que apunte `DATABASE_URL`. Estas instrucciones no se ejecutaron en la base configurada en este workspace. La migración de correo anterior sigue pendiente si todavía no está aplicada; `prisma:deploy` aplica en orden todas las migraciones pendientes.

En QA puedes guardar primero `qa@example.test` desde Alertas con `AUTO_EMAIL_ENABLED=false` para comprobar solo la persistencia. Para probar SMTP de forma separada, define `EMAIL_TEST_TO` a una bandeja autorizada y ejecuta `npm run email:test`; esa prueba envía un correo real sin información de pacientes. Las pruebas automatizadas no envían correos reales.
## Informe automático diario de garantías

El backend programa un informe diario independiente de las pantallas web. Usa la fecha civil de `America/Santiago` y la columna `Garantia.fechaLimite` de PostgreSQL; no usa los días restantes del Excel. Reutiliza los rangos existentes en `src/modules/garantias/status.ts`: vencida (menos de 0 días), crítica (0–7), próxima (8–15), atención (16–30) y normal (31 o más). El informe incluye vencidas y las que vencen dentro de 30 días, en orden de prioridad y luego por fecha límite. No incluye RUT, nombre ni diagnóstico del paciente.

El envío está **deshabilitado por defecto**. Agrega estas variables a `backend/.env` para habilitarlo:

| Variable | Predeterminado | Descripción |
| --- | --- | --- |
| `AUTO_EMAIL_ENABLED` | `false` | Usa `true` para habilitar el programador. |
| `AUTO_EMAIL_TIME` | `08:00` | Hora diaria en formato 24 horas, zona `America/Santiago`. |

También deben estar configuradas las variables SMTP y `EMAIL_FROM`. `EMAIL_TEST_TO` se reserva exclusivamente para `npm run email:test`; el informe automático no lo consulta. `EMAIL_REPORT_TO` ya no es fuente operativa: el destinatario se administra en Alertas y se guarda en PostgreSQL. Si aún existe en tu `.env`, puedes retirarla cuando quieras; cambiarla no cambia el destinatario persistido.

Aplica las migraciones pendientes y genera el cliente Prisma desde PowerShell en `backend`:

```powershell
npm run prisma:deploy
npm run prisma:generate
npm run build
```

Para probar sin correo real, ejecuta `npm test`. Las pruebas de configuración y del informe usan mocks en memoria y no conectan a SMTP ni a una base PostgreSQL. Para una prueba funcional de envío, usa una base QA aislada y un destinatario QA; no habilites el envío durante esta tarea ni apuntes una prueba a datos de pacientes reales.

### Persistencia, reintentos y supervisión

La migración `20261013090000_email_reports` crea `EnvioInformeCorreo` y `IntentoEnvioCorreo`. Su restricción única se dejó en una reserva global por fecha antes de aplicarla en la base documentada como pendiente. Si algún otro entorno ya aplicó una versión anterior de esa migración, no reemplaces una migración aplicada: prepara allí una migración correctiva después de revisar su historial. El primero conserva estado actual, contador, fechas y último resultado; el segundo guarda cada intento, su estado final, identificador de mensaje y códigos/operación de error. Un índice único por fecha local reserva como máximo un intento diario global y guarda el destinatario utilizado; así, cambiar la dirección no provoca un segundo correo el mismo día. Los fallos se reintentan cada cinco minutos, también después de un reinicio; los envíos exitosos se permiten de nuevo al día siguiente. Una reserva `EN_PROCESO` abandonada se puede recuperar después de 15 minutos. Como SMTP no ofrece una transacción exactamente una vez con PostgreSQL, una caída justo después de que SMTP acepte el mensaje pero antes de guardar el éxito puede causar un reenvío al recuperar la reserva.

Los logs de Fastify indican arranque, fecha procesada, conteos y códigos/operaciones de error; no registran el destinatario ni texto SMTP crudo, y nunca deben contener credenciales. Revisa también `EnvioInformeCorreo` en PostgreSQL para consultar estado e intentos. Un fallo SMTP no detiene el servidor ni las futuras ejecuciones programadas.

El programador solo funciona mientras el proceso backend esté activo; cerrar la ventana o detener Node detiene los envíos. En Windows, ejecuta el backend en una consola persistente para desarrollo. Para operación continua, se recomienda instalarlo como servicio de Windows mediante **NSSM** (o un administrador de servicios equivalente), configurando `node.exe` con argumentos `dist/server.js`, el directorio de trabajo `backend`, el usuario de servicio adecuado y reinicio ante fallos. Como alternativa integrada, configura el Programador de tareas para ejecutarse al iniciar el equipo, con “Reiniciar la tarea si se produce un error”, inicio en el directorio `backend` y comando `npm run start`; asegúrate de que PostgreSQL esté disponible y que el proceso reciba el `.env` correcto. No se garantiza el envío mientras el equipo/backend esté apagado.

Para detener la automatización sin cambiar código, configura `AUTO_EMAIL_ENABLED=false` y reinicia el backend. Mantén `.env` fuera del control de versiones y protege el acceso a la tabla de envíos, ya que contiene destinatarios y metadatos operativos.

## Autenticacion, roles y preparacion QA

La API usa sesiones opacas persistidas en PostgreSQL. El navegador recibe una cookie ges_session con HttpOnly, SameSite=Strict, Path=/api y una expiracion de ocho horas. Solo el hash SHA-256 del token aleatorio se guarda en la tabla de sesiones. Las contrasenas se derivan con scrypt (N=16384, r=8, p=1, sal aleatoria de 16 bytes y clave de 64 bytes); nunca se almacenan en texto plano. Las respuestas de login son genericas para cuentas inexistentes, inactivas o contrasenas incorrectas. Se limitan a cinco fallos por combinacion usuario/IP y a 30 fallos por IP en 15 minutos; el bloqueo dura 15 minutos. El limitador vive en memoria y requiere una sola instancia del backend.

| Rol | Permisos |
| --- | --- |
| ADMIN | Leer garantias, dashboard, historial y configuracion de correo; validar e importar nominas; modificar el destinatario global del correo. |
| PROFESIONAL | Leer garantias, dashboard e historial; validar e importar nominas; leer la configuracion global del correo. |
| LECTOR | Leer garantias, dashboard, historial, opciones de filtros y configuracion del correo. No puede importar ni modificar la configuracion. |

Las rutas /api/garantias (incluidas opciones de filtros), /api/dashboard, /api/importaciones y /api/notificaciones/configuracion-correo requieren sesion para lectura. POST /api/importaciones y /validar exigen ADMIN o PROFESIONAL; PUT /api/notificaciones/configuracion-correo exige ADMIN. Sin sesion, Fastify responde 401; con sesion pero sin permiso, 403. /api/auth/login inicia sesion, /api/auth/me devuelve identidad y rol y /api/auth/logout revoca la sesion actual. No hay registro publico ni contrasena predeterminada.

El login y la cookie funcionan en el navegador entre los puertos actuales porque son mismo sitio. CORS_ORIGINS debe enumerar el origen exacto del frontend; solicitudes que cambian datos requieren un Origin permitido, y CORS usa credenciales. En desarrollo el valor de ejemplo es http://localhost:8443. En produccion el backend agrega Secure a la cookie cuando NODE_ENV=production, por lo que debe servirse bajo HTTPS. Para evitar problemas de cookies SameSite=Strict, publica frontend y API bajo el mismo sitio (preferentemente detras de un reverse proxy). No expongas el puerto del backend directamente a redes no confiables.

### Crear el primer administrador y aprovisionar cuentas

No se crea ningun administrador automaticamente. Primero aplica las migraciones solo a una base QA separada y genera el cliente Prisma. Desde backend en PowerShell, confirma que la URL contiene el nombre QA esperado antes de ejecutar cualquier migracion:

~~~powershell
$qaDatabaseUrl = Read-Host "DATABASE_URL de QA"
if ($qaDatabaseUrl -notmatch '/monitor_garantias_qa(?:\?|$)') { throw "La URL no apunta a monitor_garantias_qa" }
$env:DATABASE_URL = $qaDatabaseUrl
try {
  npm.cmd run prisma:deploy
  if ($LASTEXITCODE -ne 0) { throw "prisma:deploy fallo" }
  npm.cmd run prisma:generate
  if ($LASTEXITCODE -ne 0) { throw "prisma:generate fallo" }
  npm.cmd run auth:bootstrap-admin
  if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el administrador inicial" }
} finally {
  Remove-Item Env:DATABASE_URL
}
~~~

auth:bootstrap-admin solicita usuario, nombre, correo y una contrasena nueva (minimo 14 caracteres, entrada sin eco en una terminal). Crea o habilita el primer administrador y se niega a ejecutarse si ya hay un administrador con credenciales. No incluyas contrasenas en comandos, archivos ni variables persistentes. Para crear cuentas PROFESIONAL o LECTOR despues del bootstrap, ejecuta npm.cmd run auth:provision-user; requiere un administrador activo en la base, no permite crear administradores y revoca las sesiones del usuario cuando restablece una cuenta existente. No ejecutes estos comandos contra la base actual ni la base productiva sin un procedimiento de cambio aprobado.

Las migraciones nuevas agregan Usuario.passwordHash nullable (las cuentas existentes quedan sin poder autenticarse hasta aprovisionarlas) y la tabla SesionUsuario, con hash unico de token, expiracion e indice de usuario. La migracion 20261014100000_server_authentication esta pendiente y no fue aplicada. Despues de validar QA, planifica respaldo, ventana y aprobacion antes de desplegar las migraciones a otra base. Mantener AUTO_EMAIL_ENABLED=false es independiente de la autenticacion y no debe cambiarse como parte de este procedimiento.

### Pruebas de filtros combobox

Las opciones se consultan desde PostgreSQL y se deduplican por mayusculas/minusculas en la API; se conserva una grafia representativa por valor. Los tres filtros usan equals con modo insensitive, no contains; filtros combinados se agregan al mismo where sin alterar la paginacion ni el orden solicitados. Las pruebas cubren la normalizacion, igualdad exacta y combinacion. Las pruebas de rutas usan usuarios de sesion ficticios en los mocks y no sustituyen una prueba de integracion contra una base QA migrada.

### Limitaciones operacionales pendientes

El bloqueo por intentos reside en memoria: reiniciar el proceso lo reinicia y varias instancias no comparten el contador. Para escalar, moverlo a Redis o almacenamiento central con expiracion. No hay interfaz administrativa para gestionar roles; el aprovisionamiento se hace desde una consola con acceso seguro a la base. La aplicacion de migraciones, la validacion funcional con PostgreSQL QA, la configuracion HTTPS/CORS del despliegue y una revision de seguridad operacional siguen pendientes. Las pruebas no certifican el sistema para produccion.