# Repetir informes programados en QA

Implementación y migración aplicadas el 5 de noviembre de 2026 en `monitor_garantias_qa`. No se enviaron correos reales durante este trabajo. El backend quedó detenido y `AUTO_EMAIL_ENABLED=false` para que el operador active la prueba.

## Qué cambió

`EMAIL_DEDUP_ENABLED` vale `true` si no está definida y solo admite `true` o `false`. Desactivarla exige una conexión cuyo nombre de base sea exactamente `monitor_garantias_qa`; no imprime la URL ni credenciales.

- `true`: se mantiene un informe aceptado por usuario y día. También se comprueban aceptaciones de otras ejecuciones de ese día si antes se había probado con la deduplicación desactivada.
- `false`: cada horario programado tiene su propia clave, por ejemplo `programado:10:55`. Otro horario del mismo día permite enviar otro informe, aunque exista un `ACEPTADO_SMTP` manual o de un horario anterior.
- La misma fecha y hora conservan su clave entre sondeos, reintentos, reinicios y procesos. No se genera una clave aleatoria en cada sondeo. Reiniciar con la misma hora no repite informes aceptados de esa ejecución.
- Los reintentos de una ejecución conservan su reserva, esperan cinco minutos y respetan el máximo de cinco intentos y los estados inciertos. Cada usuario sigue recibiendo exclusivamente sus tipos asignados, con actividad, recepción y correo válido comprobados otra vez antes de SMTP.
- La adquisición se serializa por usuario en PostgreSQL. Otra ejecución se aplaza mientras existe una reserva activa para ese usuario. Los tokens y el estado durable previo a SMTP siguen evitando duplicados de un mismo intento.
- El comando manual conserva su deduplicación diaria. No se habilitó el informe global.

## Migración

`20261105150000_scheduled_email_executions` agrega `EnvioInformeIndividual.claveEjecucion`, no nula, con valor predeterminado `diario`. Los registros anteriores quedan en ese ámbito y conservan IDs, destinatarios, resultados, fechas, cantidades e intentos.

Sustituye el índice único `(usuarioId, fechaInforme)` por `(usuarioId, fechaInforme, claveEjecucion)`. Es necesario cambiarlo: mantener el índice anterior impediría insertar un segundo envío del día aunque el servicio lo permitiese. No se eliminan ni sobrescriben envíos anteriores; no se usa reset ni db push.

SQL SHA-256 probado y aplicado: `9a2e3681abaa850a8ddc57734ad4df3b4ffccf5edbc06662b43c9f3b1f996b0d`. Antes de aplicar se explicó el cambio, se verificó QA, la ausencia de otras migraciones pendientes y que no había diferencias inesperadas. Después no quedan migraciones pendientes ni diferencias con el esquema Prisma.

Las huellas anteriores y posteriores coinciden para usuarios, asignaciones, pacientes, garantías, informes individuales, intentos y las tablas globales de correo. Siguen presentes los dos informes individuales y tres intentos anteriores; la columna nueva es la única adición a sus filas. No se modificaron usuarios ni asignaciones en QA.

## Cómo probar hoy con el programador real

1. En `backend/.env`, configura estos valores cuando vayas a realizar el envío real:

   ```dotenv
   AUTO_EMAIL_ENABLED=true
   EMAIL_DEDUP_ENABLED=false
   AUTO_EMAIL_TIME=11:00
   ```

   La hora anterior es un ejemplo: reemplázala por una hora nueva entre tres y cinco minutos en el futuro, en `America/Santiago`, y guarda el archivo. `AUTO_EMAIL_TIME` exige `HH:mm`. Si esa hora ya pasó, el arranque tardío solo recuperará reservas de esa ejecución; no creará envíos nuevos.

2. Desde PowerShell, en `backend`, elimina posibles valores antiguos de esa terminal para que se utilicen los del archivo y arranca antes de la hora elegida:

   ```powershell
   Set-Location 'C:\proyectos\Monitor de Garantías GES\backend'
   Remove-Item Env:AUTO_EMAIL_ENABLED -ErrorAction SilentlyContinue
   Remove-Item Env:EMAIL_DEDUP_ENABLED -ErrorAction SilentlyContinue
   Remove-Item Env:AUTO_EMAIL_TIME -ErrorAction SilentlyContinue
   npm.cmd start
   ```

   El código ya está compilado. Mantén una sola instancia. El log inicial debe indicar `enabled:true`, `dedupEnabled:false`, la hora elegida, `timeZone:America/Santiago` y `executionKey:programado:HH:mm`.

3. A la hora configurada, espera hasta 30 segundos al sondeo. Consulta los resultados en Gestión de usuarios y revisa los buzones. `ACEPTADO_SMTP` acredita aceptación por el transporte; la recepción se comprueba en el destinatario.

4. Para repetir hoy, detén la instancia con Ctrl+C, elige otra hora futura que aún no hayas usado hoy, guarda y arranca antes de ella. Para restablecer la restricción diaria usa `EMAIL_DEDUP_ENABLED=true` o elimina la variable. Para detener los envíos usa `AUTO_EMAIL_ENABLED=false` y reinicia.

Puedes consultar la hora actual y una hora de prueba sin contactar SMTP:

```powershell
node -e "console.log(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Santiago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(Date.now()+300000)))"
```

## Verificación

- Prisma generate, typecheck y build del backend correctos; la API arrancó y respondió con la autenticación esperada en un puerto temporal, con el programador desactivado. Después se cerró esa instancia.
- Suite completa: **235 pruebas en 31 archivos**.
- PostgreSQL aislado, regresión de informes individuales: **45 comprobaciones**.
- PostgreSQL aislado, **22 comprobaciones del programador real** con reloj controlado y únicamente SMTP sustituido: dos aceptaciones anteriores, nuevas tandas a distintas horas del mismo día, mismo horario sin repeticiones, reinicio, dos instancias simultáneas, reintento solo del usuario fallido, deduplicación predeterminada, inicio tardío, filtros individuales y conservación del historial.
- Las pruebas no contactaron SMTP. El siguiente envío real corresponde al operador al activar y reiniciar con una hora futura.
