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

La estructura separa rutas, controllers, services, repositories, schemas y acceso Prisma. La persistencia de garantías e importaciones está disponible. El programador envía informes individuales según Gestión de usuarios; Alertas conserva la lista global anterior como consulta histórica.

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


## Informes automáticos individuales

### Garantías visibles por usuario

El editor usa grupos con tres listas de selección múltiple y búsqueda. Cada grupo expande el producto de sus problemas, establecimientos y tipos; los criterios sin selección significan «Cualquier…». Un grupo totalmente vacío no concede acceso y se puede guardar una cuenta sin asignaciones. Los grupos adicionales vacíos deben completarse o eliminarse. El resumen cuenta combinaciones únicas; el guardado se bloquea si excede 1000. Al editar se agrupan las reglas compatibles sin agregar combinaciones cruzadas. La API y la base siguen almacenando las reglas concretas, por lo que esta interfaz no requiere otra migración y conserva el filtrado del acceso y de los informes.

Dashboard y Garantías usan las reglas de Gestión de usuarios (`Usuario.reglasAsignacion`). Cada fila combina problema de salud, establecimiento y tipo de garantía; el establecimiento corresponde a `Garantia.responsable`, importado de «Responsable de la garantía». Los criterios de una fila se intersectan y las filas se suman. Cada criterio admite «Cualquier…», pero una fila debe especificar al menos uno. ADMIN conserva acceso a todas las garantías; COORDINADOR_SOME, PROFESIONAL y LECTOR solo ven las coincidencias con sus reglas. Sin reglas, las listas, opciones de filtros y conteos quedan vacíos. La recepción de correo y el permiso de importar no amplían este acceso.

El backend consulta las reglas vigentes en cada petición y usa la misma normalización de nombres que los informes por correo. Aplica el alcance antes de contar y paginar, también en urgencias, detalles y actuaciones. Una garantía fuera del alcance devuelve 404 al consultar su detalle o intentar gestionarla. Los filtros de búsqueda solo reducen el conjunto permitido. Los informes siguen limitados a garantías pendientes vencidas o dentro de 30 días; el listado conserva sus filtros habituales. La migración `20261117120000_user_assignment_rules` agrega el campo JSONB y convierte cada tipo anterior en una regla para cualquier problema y establecimiento. `null` conserva compatibilidad con cuentas creadas mediante herramientas anteriores; `[]` revoca las asignaciones sin recuperar los tipos anteriores. La migración se aplicó en QA local el 17 de noviembre de 2026. En otro entorno ejecutar `npm run prisma:deploy` y `npm run prisma:generate` antes de reiniciar el backend.

### Selección de destinatarios

El programador utiliza exclusivamente cuentas activas con `recibirInformeAutomatico=true`, correo válido y reglas de asignación válidas. Cada cuenta recibe un mensaje independiente a `Usuario.email`, con las mismas combinaciones de problema, establecimiento y tipo que delimitan su acceso. Varias cuentas pueden compartir reglas. Las reglas también delimitan el informe del administrador. La huella de cada reserva incluye los tres criterios, para invalidarla si cambia el alcance antes del envío. No hay una alternativa global.

Se mantienen los rangos de plazo, el orden, las columnas de identificación y los formatos HTML/texto. Se excluyen las garantías `CUMPLIDA`; las demás gestiones no quitan la elegibilidad por fecha. No se envían informes vacíos. La sección de Alertas fue retirada de la interfaz; los registros globales históricos permanecen almacenados y no participan en ningún envío.

La migración `20261105120000_individual_email_reports` quedó aplicada en QA el 5 de noviembre de 2026 con autorización expresa y sin respaldo. `EnvioInformeIndividual` e `IntentoInformeIndividual` registran resultados por usuario y fecha; las tablas globales anteriores permanecen intactas.

**Mantener `AUTO_EMAIL_ENABLED=false` durante la verificación.** Consulta el [procedimiento completo de activación y las pruebas](../INFORMES_INDIVIDUALES.md) antes de aplicar la nueva migración o habilitar el envío.

### Vista previa sin correo

Desde `backend`, con las dependencias instaladas:

```powershell
npm.cmd run build
node dist/scripts/email-preview.js
# También: npm.cmd run email:preview -- --date 2026-11-05
```

La vista previa realiza consultas READ ONLY sobre las tablas existentes. Devuelve índices anónimos, cantidades de tipos y garantías y motivos de exclusión; no construye HTML/texto, no usa SMTP y no escribe reservas. Está disponible también para ADMIN en `GET /api/notificaciones/vista-previa-individual?fecha=AAAA-MM-DD`.

`email:report:test` y su archivo anterior son ahora un alias de esta vista previa, sin envíos. Las funciones anteriores de envío global fallan explícitamente con `GLOBAL_REPORT_DISABLED`. La prueba `email:test` sigue siendo exclusivamente un mensaje sintético sin información de pacientes dirigido a `EMAIL_TEST_TO`; es un envío real solo si un operador lo invoca expresamente. No se ejecutó durante esta etapa.

### Envío manual inmediato de un solo informe real

Con `AUTO_EMAIL_ENABLED=false`, desde `backend`:

```powershell
npm.cmd run build
node dist/scripts/email-send-individual.js --list
node dist/scripts/email-send-individual.js --user <UUID-elegido>
# Solo después de autorizar el destinatario mostrado y los datos reales:
node dist/scripts/email-send-individual.js --user <UUID-elegido> --send --confirm-email <correo-mostrado> --confirm-scope <huella-mostrada> --confirm-real-data
```

Reemplaza los marcadores por los valores mostrados. También está disponible `npm.cmd run email:send:individual -- ...`. Sin `--send` no hay SMTP ni reservas. Las tres confirmaciones son obligatorias; el correo y la huella de sus tipos se revalidan antes de SMTP. Usa únicamente el usuario elegido, el filtrado del servicio individual y la fecha actual de Santiago. Comparte la deduplicación y los intentos con el programador; no permite cambiar la fecha ni forzar reenvíos. Una aceptación manual se identifica con `codigoResultado=ENVIO_MANUAL` en la reserva y el intento. La salida muestra destinatario autorizado, cantidad, estado, identificador SMTP y errores controlados, sin cuerpos ni datos de pacientes. No habilita el programador ni utiliza la lista global.

La preparación y verificación no envían datos reales: hace falta confirmar expresamente una cuenta antes de ejecutar el último comando.

### Persistencia y reintentos

`EMAIL_DEDUP_ENABLED=true` es el comportamiento predeterminado: impide repetir un informe aceptado por SMTP para un usuario ese día. En `monitor_garantias_qa`, `false` permite otra ejecución programada al configurar otra hora del mismo día. La clave única es `(usuarioId, fechaInforme, claveEjecucion)`: los informes anteriores y diarios usan `diario`; las pruebas programadas usan `programado:HH:mm`. El mismo horario conserva su reserva entre sondeos, reintentos, reinicios y procesos; no produce un bucle de envíos. El comando manual conserva la restricción diaria. Ver [cómo probar el programador real hoy](../PRUEBA_PROGRAMADOR_QA.md).

Cada intento tiene un token propio. La cuenta, el correo y los tipos se revalidan bajo bloqueos antes de construir el mensaje y llamar SMTP. Los cambios de configuración de un envío reservado/fallido cancelan ese informe de la ejecución, sin reutilizar su destinatario o contenido. No se sobrescriben envíos de otras ejecuciones. Al volver a activar la deduplicación diaria también se comprueban aceptaciones de los horarios de prueba.

Se reintentan fallos transitorios inequívocos cada cinco minutos, hasta cinco intentos por usuario y día. Los fallos permanentes no se reintentan. Solo se recuperan reservas abandonadas antes de iniciar SMTP. Los intentos que pudieron haber contactado SMTP y quedaron abandonados, los timeouts después de DATA y los fallos al persistir aceptación se consideran `INCIERTO`: requieren revisión y no se reenvían automáticamente.

`EDNS` es un fallo de resolución anterior a SMTP y permite el mismo reintento acotado. Las reservas antiguas que lo guardaron como no reintentable se reevaluan con esta política sin editar el intento anterior; se mantienen los cinco minutos y el límite de intentos. La excepción no permite reenviar estados `ACEPTADO_SMTP`, `OMITIDO` o `INCIERTO`.

`ACEPTADO_SMTP` significa aceptación del transporte, **no entrega a la bandeja**. Los nuevos registros no utilizan un estado de entrega confirmada. El historial global anterior se conserva con sus estados originales.

Un fallo individual no bloquea al resto. Los logs contienen conteos y códigos, sin destinatarios, datos de pacientes ni errores SMTP crudos. El proceso debe estar activo antes de la hora `AUTO_EMAIL_TIME` en `America/Santiago`. Si inicia tarde solo recupera reservas individuales existentes; las nuevas esperan al día siguiente. No deben ejecutarse instancias antiguas del backend junto a la nueva versión.

## Autenticacion, roles y preparacion QA

La API usa sesiones opacas persistidas en PostgreSQL. El navegador recibe una cookie ges_session con HttpOnly, SameSite=Strict, Path=/api y una expiracion de ocho horas. Solo el hash SHA-256 del token aleatorio se guarda en la tabla de sesiones. Las contrasenas se derivan con scrypt (N=16384, r=8, p=1, sal aleatoria de 16 bytes y clave de 64 bytes); nunca se almacenan en texto plano. Las respuestas de login son genericas para cuentas inexistentes, inactivas o contrasenas incorrectas. Se limitan a cinco fallos por combinacion usuario/IP y a 30 fallos por IP en 15 minutos; el bloqueo dura 15 minutos. El limitador vive en memoria y requiere una sola instancia del backend.

| Rol | Permisos |
| --- | --- |
| ADMIN | Leer garantias, dashboard, historial y configuracion de correo; validar e importar nominas; modificar los destinatarios globales del correo. |
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

auth:bootstrap-admin solicita usuario, nombre, correo y una contrasena nueva (minimo 8 caracteres, entrada sin eco en una terminal). Crea o habilita el primer administrador y se niega a ejecutarse si ya hay un administrador con credenciales. No incluyas contrasenas en comandos, archivos ni variables persistentes. Para crear cuentas PROFESIONAL o LECTOR despues del bootstrap, ejecuta npm.cmd run auth:provision-user; requiere un administrador activo en la base, no permite crear administradores y revoca las sesiones del usuario cuando restablece una cuenta existente. No ejecutes estos comandos contra la base actual ni la base productiva sin un procedimiento de cambio aprobado.

Las migraciones nuevas agregan Usuario.passwordHash nullable (las cuentas existentes quedan sin poder autenticarse hasta aprovisionarlas) y la tabla SesionUsuario, con hash unico de token, expiracion e indice de usuario. La migracion 20261014100000_server_authentication esta pendiente y no fue aplicada. Despues de validar QA, planifica respaldo, ventana y aprobacion antes de desplegar las migraciones a otra base. Mantener AUTO_EMAIL_ENABLED=false es independiente de la autenticacion y no debe cambiarse como parte de este procedimiento.

### Pruebas de filtros combobox

Las opciones se consultan desde PostgreSQL y se deduplican por mayusculas/minusculas en la API; se conserva una grafia representativa por valor. Los tres filtros usan equals con modo insensitive, no contains; filtros combinados se agregan al mismo where sin alterar la paginacion ni el orden solicitados. Las pruebas cubren la normalizacion, igualdad exacta y combinacion. Las pruebas de rutas usan usuarios de sesion ficticios en los mocks y no sustituyen una prueba de integracion contra una base QA migrada.

### Limitaciones operacionales pendientes

El bloqueo por intentos reside en memoria: reiniciar el proceso lo reinicia y varias instancias no comparten el contador. Para escalar, moverlo a Redis o almacenamiento central con expiracion. No hay interfaz administrativa para gestionar roles; el aprovisionamiento se hace desde una consola con acceso seguro a la base. La aplicacion de migraciones, la validacion funcional con PostgreSQL QA, la configuracion HTTPS/CORS del despliegue y una revision de seguridad operacional siguen pendientes. Las pruebas no certifican el sistema para produccion.

### Scheduler de informes automáticos

El mecanismo operativo es exclusivamente individual. Ver la sección de informes individuales y el procedimiento enlazado; mantener AUTO_EMAIL_ENABLED=false hasta completar la migración y verificación autorizadas.
