# Dashboard y Garantías: diagnóstico del 500 y procedimiento de recuperación

Revisión: 3 de noviembre de 2026. Proyecto: Monitor de Garantías GES original.

## 1. Causa confirmada

**El código y Prisma Client ya consultan el esquema nuevo, pero `monitor_garantias_qa` conserva el esquema anterior.** La migración de seguimiento no está aplicada. Se reprodujo el fallo tanto con consultas de diagnóstico de solo lectura como con los repositorios compilados que usa el backend.

| Comprobación ejecutada | Resultado |
| --- | --- |
| Nombre de base en `backend/.env` | `monitor_garantias_qa` |
| Nombre de base en la conexión efectiva | `monitor_garantias_qa`; sin override de DATABASE_URL en el proceso de diagnóstico |
| `current_database()` | `monitor_garantias_qa` |
| Transacciones de inspección | `transaction_read_only=on` |
| Cliente generado y CLI instalados | Prisma **6.19.3**, ambos |
| Modelo del cliente generado | Incluye `estadoGestion`, `revisionGestion` y relación `eventos` |
| `Garantia.estadoGestion` y `Garantia.revisionGestion` en QA | No existen |
| Tabla `EventoGarantia` en QA | No existe |
| Tres enums nuevos en QA | No existen |
| Conteo equivalente al Dashboard con `estadoGestion != CUMPLIDA` | Prisma **P2022** |
| `findMany` de garantías con columnas escalares del modelo nuevo | Prisma **P2022** |
| `SELECT "estadoGestion", "revisionGestion" FROM "Garantia" LIMIT 0` | SQLSTATE **42703**, columna inexistente, encapsulado por Prisma como P2010 |
| `SELECT "id" FROM "EventoGarantia" LIMIT 0` | SQLSTATE **42P01**, tabla inexistente, encapsulado por Prisma como P2010 |
| `dashboardData()` del repositorio compilado | Prisma **P2022**, modelo Garantia |
| `listGuarantees()` compilado con los parámetros exactos informados | Prisma **P2022**, modelo Garantia |

No se observó P2021 en estas pruebas: la ausencia de la tabla quedó acreditada directamente con SQLSTATE 42P01. No se registró ninguna actuación ni se creó una sesión para reproducir los fallos; se llamaron exclusivamente funciones de lectura, sin iniciar `server.ts`.

### Por qué falla Garantías incluso con `soloPendientes=false`

Ese parámetro desactiva la condición operativa de excluir cumplidas. Sin embargo, `findMany` solicita las columnas escalares del modelo Prisma, incluyendo las dos nuevas. Por tanto, quitar el filtro no elimina la dependencia del esquema actualizado. El Dashboard además filtra y cuenta expresamente por `estadoGestion`.

El detalle también requiere la tabla de eventos y los informes operativos consultan el nuevo estado. Corregir solo una consulta o retirar los controles nuevos no resolvería la incompatibilidad completa.

Fuentes: [repositorio del Dashboard](backend/src/modules/dashboard/repository.ts), [repositorio de garantías](backend/src/modules/garantias/repository.ts), [esquema Prisma](backend/prisma/schema.prisma), [selección de informes](backend/src/modules/notificaciones/email-report-repository.ts).

## 2. Estado actual de QA

Instantánea agregada, sin extraer registros personales:

| Tabla | Registros |
| --- | ---: |
| Paciente | 212 |
| Garantia | 216 |
| Usuario | 3 |
| SesionUsuario | 1 |
| Importacion | 9 |
| ErrorImportacion | 0 |
| ConfiguracionNotificaciones | 1 |
| EnvioInformeCorreo | 2 |
| IntentoEnvioCorreo | 2 |
| Establecimiento | 1 |
| ProblemaSalud | 5 |
| TipoGarantia | 4 |
| CombinacionProblemaGarantia | 5 |
| AreaResponsabilidad | 1 |

El análisis de áreas continúa fuera del alcance funcional; aquí se comprueba su conservación como parte de los datos existentes.

Hay **cero garantías con `gestionadaAt` informada**, cero gestores huérfanos y cero registros con gestor informado sin fecha. En esta instantánea, la migración inicializaría las 216 garantías como SIN_GESTION y no crearía antecedentes de gestión.

Las siete migraciones anteriores figuran finalizadas, sin reversión, y sus checksums coinciden con los archivos locales:

1. `20261008000000_initial`.
2. `20261013090000_email_reports`.
3. `20261013100000_email_recipient_config`.
4. `20261014100000_server_authentication`.
5. `20261021120000_multiple_notification_recipients`.
6. `20261029120000_user_coordinator_import_permission`.
7. `20261030120000_responsibility_areas`.

La única migración local pendiente es:

**`20261103120000_guarantee_management_timeline`**.

No se encontró una aplicación parcial de sus enums, columnas o tabla. El usuario de la conexión tiene permiso CREATE en public, UPDATE en Garantia y acceso al rol propietario de esa tabla. Esto reduce riesgos de permisos conocidos, sin garantizar que no aparezca otro problema operacional al ejecutar DDL.

## 3. Revisión completa del SQL pendiente

Archivo revisado: [migration.sql](backend/prisma/migrations/20261103120000_guarantee_management_timeline/migration.sql).

| Operación | Efecto |
| --- | --- |
| `BEGIN` / `COMMIT` | Agrupa los cambios SQL en una transacción |
| Crear enum `EstadoGestion` | SIN_GESTION, EN_GESTION, PENDIENTE_RESOLUCION, CUMPLIDA |
| Crear enum `TipoActuacion` | Los seis tipos de actuación implementados |
| Crear enum `TipoEventoGarantia` | ACTUACION, CAMBIO_ESTADO, CUMPLIMIENTO, REAPERTURA, ANTECEDENTE_LEGADO |
| Agregar `Garantia.estadoGestion` | Obligatoria, default SIN_GESTION |
| Agregar `Garantia.revisionGestion` | Entero obligatorio, default 0 |
| Crear tabla `EventoGarantia` | UUID, secuencia SERIAL, garantía, autor, categoría, actuación, comentario, estados, respaldo, fecha, metadatos y clave legado |
| Crear índices | Unicidad de secuencia y clave legado; búsqueda de cronología y filtro por estado/fecha límite |
| Insertar antecedentes | Solo para garantías con una última gestión anterior conocida |
| Actualizar estado inicial | EN_GESTION solo donde `gestionadaAt IS NOT NULL` |

La tabla nueva usa `CURRENT_TIMESTAMP` como default de creación. Los antecedentes copian su fecha original; las nuevas actuaciones proporcionan la fecha del servidor desde la aplicación. La secuencia define un desempate estable y no cambia los UUID de garantías o pacientes.

### Conservación de la información anterior

- No hay DROP TABLE, TRUNCATE, DELETE ni reconstrucción de tablas.
- No se actualizan `gestionadaAt`, `gestionadaPorUsuarioId`, fechas de plazo, datos del paciente, responsable, versión de importación, `createdAt` ni `updatedAt` de las garantías existentes.
- Para una gestión anterior se copia fecha, usuario y nombre conocido del autor. Tipo de actuación y comentario quedan nulos; no se inventa cumplimiento.
- El ID legado es determinista y su clave es única por garantía. El INSERT incluye `ON CONFLICT ("claveLegado") DO NOTHING`.
- Las garantías que nunca tuvieron gestión no reciben eventos históricos ficticios.

### Restricciones nuevas

- FK de evento a garantía con DELETE RESTRICT: protege la cronología frente al borrado de su garantía.
- FK de evento a usuario con DELETE SET NULL: mantiene el evento y su nombre de autor si desaparece la referencia del usuario.
- CHECK: un evento de cumplimiento requiere respaldo no vacío.
- CHECK: una reapertura requiere motivo no vacío en comentario.
- CHECK: una actuación requiere su tipo.
- Claves únicas para secuencia y antecedente legado, además del UUID del evento.

Los antecedentes no son actuaciones ni cumplimientos, por lo que sus campos desconocidos nulos satisfacen estas restricciones.

### Riesgos concretos

1. `ALTER TABLE`, índices y backfill necesitan bloqueos. Se debe detener el backend y evitar otras escrituras durante la ventana.
2. Falta de espacio, permisos o conflictos con objetos creados manualmente podrían abortar la transacción. En la inspección actual los objetos nuevos están ausentes y los permisos comprobados son suficientes para las operaciones principales.
3. Una migración fallida puede dejar un registro incompleto en `_prisma_migrations` aunque se revierta su DDL. Debe revisarse ese estado; no usar reset, db push o resolve automáticamente.
4. `migrate deploy` aplica todas las pendientes, no solo una elegida. El verificador exige que antes de aplicar exista exactamente esta migración pendiente.
5. Un backend anterior no debe volver a escribir gestiones después de migrar: no generaría los eventos nuevos. Se deben desplegar esquema, cliente y código compatibles.
6. El SQL no es un instalador repetible completo: CREATE TYPE/TABLE fallará si se vuelve a ejecutar manualmente. Debe aplicarse por el historial versionado de Prisma.

No se detectó una condición de los datos actuales que deba hacer fallar el backfill. La migración ya fue probada en PostgreSQL temporal aislado durante la etapa anterior, con antecedentes y casos nuevos; **eso no equivale a haberla aplicado ni validado en QA**.

## 4. Comprobaciones adicionales y cambios realizados ahora

- Los archivos compilados de Dashboard y Garantías contienen los filtros de gestión nuevos, y tienen fecha posterior a sus fuentes. Sus funciones compiladas reproducen exactamente P2022.
- El cliente generado también contiene los campos y relación nuevos. No se encontró evidencia de que el problema sea un cliente antiguo o un build sin esos cambios.
- No se puede certificar desde esta revisión qué proceso/configuración ejecuta la terminal del usuario. El procedimiento incluye reconstruir y reiniciar de forma explícita.
- El origen `http://192.168.16.100:8443` está en CORS_ORIGINS junto con localhost. No se encontró un problema de origen permitido que explique estos 500.
- `AUTO_EMAIL_ENABLED` continúa en `true` en el archivo local. No se editó ese archivo ni se inició un backend. El reinicio propuesto lo sobrescribe a `false` solo en la consola dedicada.

**No fue necesario corregir consultas ni cambiar el diseño.** No se retiró ninguna funcionalidad. La incompatibilidad confirmada requiere la migración autorizada; regenerar el cliente o reconstruir por sí solos no crea las estructuras faltantes.

Se añadió [verify-qa-management.ts](backend/scripts/verify-qa-management.ts), una herramienta de inspección y conservación de datos que:

- Exige `monitor_garantias_qa` tanto en `.env` como en la conexión efectiva y verifica `current_database()`.
- Ejecuta las consultas en una transacción READ ONLY.
- Comprueba migraciones, checksums, estructuras y referencias anteriores.
- En `--before` guarda solo conteos y huellas agregadas de las 14 tablas existentes en un archivo local; no guarda filas personales ni credenciales y no sobrescribe un snapshot existente.
- En `--after` exige la migración aplicada, inicialización correcta y coincidencia de conteos y huellas de los datos anteriores. Excluye únicamente los dos campos nuevos al comparar Garantia.
- No importa el servidor, no crea sesiones, no modifica QA y no llama a SMTP.

Se ejecutaron correctamente typecheck, build del backend y `--before` en QA en modo solo lectura. También se comprobó que `--after` rechaza el esquema actual sin migrar. Ese rechazo es esperado y evita aprobar una aplicación incompleta.

El snapshot de diagnóstico quedó localmente en `backend/.tmp-qa-management-before.json`, ignorado por Git. Debe tomarse uno nuevo después de detener el backend para la ventana aprobada, porque puede haber actividad entre esta revisión y el despliegue. El snapshot **no sustituye el respaldo**.

## 5. Procedimiento exacto — preparado, NO ejecutado

**No ejecutar esta sección hasta recibir autorización posterior para la migración de QA.** No se ejecutaron respaldo, migración ni reinicio durante este diagnóstico.

### A. Detener escrituras y fijar la conexión

Detener el backend actual con Ctrl+C en su terminal y confirmar que no quede otro proceso backend escribiendo. Mantener PostgreSQL QA en ejecución. Usar una consola PowerShell nueva y dedicada:

```powershell
Set-Location -LiteralPath 'C:\proyectos\Monitor de Garantías GES\backend'
$ErrorActionPreference = 'Stop'
$env:AUTO_EMAIL_ENABLED = 'false'

# Entrada oculta: la URL no aparece en el historial de comandos ni en pantalla.
$secureQaUrl = Read-Host 'DATABASE_URL exacta de monitor_garantias_qa' -AsSecureString
$qaPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureQaUrl)
try {
  $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($qaPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($qaPointer)
}
try { $qaUri = [Uri]$env:DATABASE_URL } catch { throw 'URL de QA inválida; no continuar.' }
if ($qaUri.Scheme -notin @('postgresql', 'postgres') -or $qaUri.AbsolutePath.Trim('/') -cne 'monitor_garantias_qa') {
  throw 'El destino no es exclusivamente monitor_garantias_qa; no continuar.'
}

npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Falló typecheck; no continuar.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Falló build; no continuar.' }

$qaStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$qaSnapshot = Join-Path (Get-Location) ".tmp-qa-management-before-$qaStamp.json"
node dist/scripts/verify-qa-management.js --before $qaSnapshot
if ($LASTEXITCODE -ne 0) { throw 'La comprobación previa no aprobó el destino o el estado; no continuar.' }
```

La herramienta comprueba también la configuración del archivo `.env`. Si cualquiera de los destinos no es QA, se detiene antes de conectar. No publicar la URL ni el contenido de las variables de conexión.

### B. Respaldo completo previo

En la misma consola, con binarios PostgreSQL 18 y una carpeta de respaldo fuera del repositorio:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$qaBackupDirectory = 'C:\respaldos\MonitorGES'
New-Item -ItemType Directory -Path $qaBackupDirectory -Force | Out-Null
$qaBackup = Join-Path $qaBackupDirectory "monitor_garantias_qa-before-management-$qaStamp.dump"
if (Test-Path -LiteralPath $qaBackup) { throw 'Ya existe ese respaldo; elegir otro nombre.' }

# Las credenciales se pasan por entorno, nunca como argumento de proceso.
$qaUserInfo = $qaUri.UserInfo.Split(':', 2)
$env:PGHOST = $qaUri.Host
$env:PGPORT = if ($qaUri.Port -gt 0) { [string]$qaUri.Port } else { '5432' }
$env:PGUSER = [Uri]::UnescapeDataString($qaUserInfo[0])
$env:PGDATABASE = 'monitor_garantias_qa'
$env:PGCONNECT_TIMEOUT = '10'
$env:PGPASSWORD = if ($qaUserInfo.Count -gt 1) { [Uri]::UnescapeDataString($qaUserInfo[1]) } else { '' }
try {
  & (Join-Path $pgBin 'pg_dump.exe') --no-password --format=custom --file $qaBackup --dbname monitor_garantias_qa
  if ($LASTEXITCODE -ne 0) { throw 'Falló el respaldo; no ejecutar migraciones.' }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
if ((Get-Item -LiteralPath $qaBackup).Length -eq 0) { throw 'El respaldo está vacío; no continuar.' }
& (Join-Path $pgBin 'pg_restore.exe') --list $qaBackup | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer el archivo de respaldo; no continuar.' }
Get-FileHash -LiteralPath $qaBackup -Algorithm SHA256
```

El dump contiene información de la base: conservarlo en la ubicación de respaldo con acceso restringido, sin adjuntarlo al chat ni al repositorio. Poder listar el archivo comprueba que sea legible, pero no sustituye una prueba de restauración en otra base aislada cuando el procedimiento de respaldo la exija. Este respaldo no se restaurará automáticamente sobre QA.

### C. Aplicación con Prisma 6

Revisar el SQL indicado y conservar la misma ventana sin escrituras. El `--before` anterior debe haber mostrado **exactamente una pendiente**, `20261103120000_guarantee_management_timeline`, con las siete anteriores coincidentes.

```powershell
# Únicamente después de aprobar explícitamente la migración y comprobar el respaldo.
$env:AUTO_EMAIL_ENABLED = 'false'
npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Falló migrate deploy. No iniciar backend ni reparar el historial automáticamente.' }

npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Falló la generación de Prisma Client; no iniciar.' }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Falló typecheck; no iniciar.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Falló build; no iniciar.' }

# Ejecutar ANTES del reinicio o de cualquier login/actuación que cambie los datos.
node dist/scripts/verify-qa-management.js --after $qaSnapshot
if ($LASTEXITCODE -ne 0) { throw 'No se verificó la conservación del estado anterior; revisar antes de iniciar.' }

npm.cmd exec -- prisma migrate status
if ($LASTEXITCODE -ne 0) { throw 'El historial de migraciones no está actualizado; revisar.' }
```

El resultado esperado del verificador es `priorRecordsPreserved: true`, ninguna migración pendiente, ambas columnas presentes, tabla y tres enums disponibles, 216 garantías SIN_GESTION y revisión 0. Con los datos observados, EventoGarantia tendrá cero filas inicialmente; eso es correcto porque no existen gestiones anteriores conocidas.

La comparación exige que las tablas anteriores no hayan cambiado durante la ventana; un login puede cambiar sesiones, por eso debe hacerse antes de reiniciar y probar en navegador.

Si falla la migración, detener el procedimiento. Revisar el error y `_prisma_migrations` antes de decidir una reparación específica. No ejecutar migrate reset, db push, eliminación de tablas, ni marcar una migración como aplicada o revertida sin inspección y autorización.

### D. Reinicio con automatización deshabilitada

Solo cuando C haya terminado correctamente, en la misma consola:

```powershell
$env:AUTO_EMAIL_ENABLED = 'false'
npm.cmd start
```

El script usa `node dist/src/server.js`. Confirmar en los logs el arranque y «Envío automático de informes de correo deshabilitado». El valor de entorno de esta consola prevalece sobre `.env` al cargar dotenv. No iniciar simultáneamente otro backend con otra configuración. Si se cierra la consola, volver a fijar ese valor antes de un nuevo arranque.

No se necesita ejecutar un script SMTP, un seed, una importación ni un registro de gestión para recuperar y comprobar estas lecturas.

## 6. Verificar la recuperación desde el navegador

Abrir `http://192.168.16.100:8443` con la sesión autorizada y revisar la pestaña Red de las herramientas del navegador:

1. `GET /api/dashboard` debe responder 200 y devolver `conteosPorEstado`, `conteosPorGestion` y `garantiasUrgentes`.
2. Repetir la consulta original:

   ```text
   GET /api/garantias?estado=atencion,critica,normal,proxima&soloPendientes=false&page=1&limit=12&sort=fechaLimite&order=asc
   ```

   Debe responder 200 con datos y paginación. Las vencidas siguen excluidas por esos cuatro estados, de manera explícita.
3. En la instantánea del 3 de noviembre, el Dashboard tendría SIN_GESTION=216 y las otras tres categorías=0. La consulta anterior tendría total=130 y hasta 12 filas en la primera página, si no cambian datos ni fecha civil.
4. Pulsar la tarjeta Sin gestión: debe mostrar total=216 e incluir las vencidas. Esto comprueba que el acceso por gestión no conserva la exclusión predeterminada de plazos.
5. Abrir una garantía existente por su UUID desde la interfaz: el detalle debe responder 200 y devolver una cronología vacía en esta base, sin inventar antecedentes.
6. Confirmar que no hay 500 nuevos en las peticiones ni en los logs. No probar escrituras de gestión, carga o correo dentro de esta verificación de lectura.

Si se prueba otro día, los conteos de plazo pueden cambiar por el calendario sin que cambien los registros; los cuatro estados de gestión no cambian solo por el transcurso del tiempo.

## 7. Logs de la terminal y límites de la comprobación

No hay un archivo de log del backend identificado en el proyecto y no se leyó el contenido de la terminal del usuario. La causa se reprodujo directamente con el repositorio compilado y QA, por lo que no se necesita esperar un log para confirmar la incompatibilidad.

Si después del procedimiento autorizado persiste un 500, copiar únicamente:

- Método y ruta que fallan, código HTTP y `requestId` de la respuesta.
- La entrada de error de Fastify con ese mismo requestId, incluyendo nombre del error Prisma, `code`, `meta.modelName`, columna/tabla y SQLSTATE cuando estén presentes.
- La ubicación del archivo en el stack que identifique si ejecuta `src` o `dist`.
- El resultado de `node dist/scripts/verify-qa-management.js --inspect`, que ya oculta credenciales y filas personales.

No copiar DATABASE_URL, contraseñas, cookies, tokens, mensajes SMTP completos ni registros de pacientes. Una captura del 500 genérico del navegador sin el error del servidor no permite diagnosticar una causa adicional.

## Estado al entregar este diagnóstico

QA sigue sin la migración nueva. No se modificaron registros, destinatarios, SMTP, horarios ni el diseño del frontend. No se inició/reinició el backend ni se envió correo. Se añadió el verificador, se compiló localmente y se preparó el procedimiento revisable.

**Las consultas reales no pueden darse por restauradas todavía:** falta autorizar y aplicar el cambio de esquema confirmado, verificar la conservación de datos y reiniciar la versión compatible. Esa es la escritura pendiente que este diagnóstico no ejecutó.
