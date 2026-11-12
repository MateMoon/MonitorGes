# Informes automáticos individuales por tipo de garantía

**Continuación: pruebas del programador el mismo día.** Se aplicó `20261105150000_scheduled_email_executions` y se añadió `EMAIL_DEDUP_ENABLED`, predeterminada `true`. En QA puede ser `false`: cada nuevo horario produce su propia ejecución, conservando historial y protecciones contra duplicados de esa ejecución. El [procedimiento actual del programador](PRUEBA_PROGRAMADOR_QA.md) documenta la migración, las pruebas y la configuración. Durante esta continuación no se enviaron correos y se dejó el backend detenido con `AUTO_EMAIL_ENABLED=false`. Las referencias siguientes a la clave única diaria describen la etapa anterior.

**Actualización del 5 de noviembre de 2026:** con autorización específica se aplicó en `monitor_garantias_qa` exclusivamente `20261105120000_individual_email_reports`, sin respaldo. Su checksum coincide con el probado y no hubo diferencias de esquema inesperadas; después no quedan migraciones pendientes. Las huellas de contenido de usuarios, asignaciones, pacientes, garantías y tablas de correo anteriores coinciden antes/después. Se regeneró Prisma, pasaron typecheck/build y la API volvió a iniciar con `AUTO_EMAIL_ENABLED=false`.

Se agregó `backend/scripts/email-send-individual.ts` para elegir una sola cuenta y exigir confirmación del correo, huella de asignaciones y envío de datos reales. Reutiliza el servicio individual y sus reservas, sin forzar reenvíos ni activar automatización. El [README del backend](backend/README.md#envío-manual-inmediato-de-un-solo-informe-real) explica los comandos. Después de mostrar las dos cuentas elegibles y preguntar por la autorización de datos reales, el usuario solicitó enviar a todas las cuentas asignadas en Gestión de usuarios. Se ejecutaron dos comandos individuales: SMTP aceptó un informe de **16 garantías** y otro de **103 garantías**, ambos con `codigoResultado=ENVIO_MANUAL`, identificador SMTP y fecha de aceptación persistidos. No se confirma recepción en el buzón desde el servidor.

El primer intento del informe de 16 garantías falló con `EDNS` bajo la restricción de red del entorno. Se verificó conexión y autenticación SMTP con los permisos de red necesarios, sin enviar un mensaje adicional. Se corrigió la clasificación de `EDNS` como fallo de DNS anterior a SMTP, permitiendo reintentos normales acotados. Los fallos EDNS anteriores se reevaluan al adquirir la reserva, sin editar el intento histórico. Tras cumplirse los cinco minutos, el segundo intento fue aceptado. Permanecen dos reservas y tres intentos: un EDNS fallido y dos aceptaciones. No se borraron reservas, no se alteraron asignaciones y no se reenviaron informes aceptados.

Verificación final: **232 pruebas en 31 archivos** y **45 comprobaciones PostgreSQL aisladas**, incluyendo confirmaciones, un solo destinatario, deduplicación compartida, espera DNS y conservación del intento anterior. La API fue reiniciada con el código final; `AUTO_EMAIL_ENABLED=false` permanece tanto en `.env` como en el proceso. La lectura final confirma que usuarios, asignaciones, pacientes, garantías e historial global conservan sus huellas iniciales y que no hay otras migraciones pendientes.

Las secciones siguientes conservan el registro de la etapa inicial, anterior a esta autorización y aplicación de la migración.

Implementación del 5 de noviembre de 2026. El mecanismo operativo del código ahora es exclusivamente individual. Durante esta etapa no se enviaron correos reales ni se aplicó la nueva migración en QA.

## Estado del entorno

La inspección inicial de `monitor_garantias_qa` confirmó las nueve migraciones anteriores aplicadas y con checksums coincidentes, incluida la de Gestión de usuarios. Se encontró `AUTO_EMAIL_ENABLED=true` en `backend/.env`; se cambió a `false` sin modificar las demás variables. Se identificaron y detuvieron el backend local y su vigilancia de este proyecto para evitar envíos durante el trabajo. Vite y PostgreSQL no se detuvieron.

La única migración nueva es `20261105120000_individual_email_reports`. Está **pendiente en QA** y requiere una autorización específica para aplicarla. La autorización de la migración de usuarios de la etapa anterior no se utilizó para esta nueva migración. No se ejecutaron reset, db push, seed, importaciones ni cambios de usuarios en QA.

El archivo SQL probado en el clúster aislado tiene SHA-256 `c4a1a1aeb6aa118b4d3a7d565ee927d9a83773f0fef111cfd8eedf709caddca6`. La comparación final de QA con el esquema declarado muestra exclusivamente el enum, las dos tablas y sus índices/referencias nuevos; no propone modificar tablas anteriores.

Al finalizar se restauró la API compilada en el puerto 3001 con `AUTO_EMAIL_ENABLED=false`; el log confirma modo individual y automatización deshabilitada. La aplicación puede seguir administrando usuarios y consultando la vista previa sin activar envíos. La consulta de resultados comunica que el historial aún no está disponible porque falta la migración. El frontend sigue disponible en el puerto 8443.

La vista previa READ ONLY realizada sobre QA para `2026-11-05` revisó tres cuentas y calculó **cero correos potenciales**: dos cuentas tienen la recepción deshabilitada y la tercera no tiene tipos asignados. No se imprimieron nombres, correos, RUT ni IDs de usuarios.

## Selección y contenido

Los destinatarios se obtienen de `Usuario` y `UsuarioTipoGarantia`. Se exige simultáneamente cuenta activa, `recibirInformeAutomatico=true`, correo registrado válido y al menos un tipo normalizado válido. Ningún perfil, incluido ADMIN, recibe garantías adicionales por su rol.

La identidad de un tipo usa `normalizeIdentityText`, exactamente la normalización del importador. Se comparan nombres con diferencias equivalentes de tildes, mayúsculas, puntuación y espacios; no hay equivalencias aproximadas ni alias inventados.

Antes de leer datos de pacientes se consultan los nombres distintos de las garantías y se seleccionan únicamente los que coinciden con los tipos de ese usuario. La consulta posterior restringe `nombreGarantia` a esos nombres originales, `estadoGestion != CUMPLIDA` y fecha límite dentro del umbral vigente. Una defensa adicional en el servicio vuelve a comprobar las claves permitidas antes de formatear.

Se mantienen los rangos actuales: vencidas, críticas (0–7), próximas (8–15) y atención (16–30); se excluyen normales y cumplidas. `EN_GESTION` y `PENDIENTE_RESOLUCION` siguen siendo elegibles por fecha. Se conserva la ordenación y el HTML/texto existentes, incluyendo nombre del paciente, RUT, garantía, fecha límite, plazo y responsable. El responsable se muestra como columna, pero **no se utiliza para asignar ni filtrar**.

Cada mensaje tiene un único `to` escalar tomado del correo de la cuenta, sin CC ni lista colectiva. Un tipo compartido produce mensajes independientes con ese tipo para cada usuario elegible. Nunca se utiliza un informe general como alternativa ante errores. Si no hay garantías elegibles, se registra `OMITIDO / SIN_GARANTIAS_ELEGIBLES` y no se llama a SMTP. Las cuentas no elegibles sin reserva previa no generan reservas nuevas.

No se modifican pacientes, `Garantia.responsable`, asignaciones individuales, áreas, login, roles ni permisos de lectura de las API.

## Reservas, intentos y seguridad de revalidación

`EnvioInformeIndividual` contiene la reserva única `(usuarioId, fechaInforme)`, destinatario usado, huella del correo/tipos, token de reserva, contador de intentos, cantidades, fechas, resultado e identificador SMTP. `IntentoInformeIndividual` conserva cada intento mediante clave única `(envioId, numero)`. Los registros no almacenan el cuerpo del correo ni listas de pacientes.

Estados nuevos:

| Estado | Significado |
| --- | --- |
| `RESERVADO` | Trabajo adquirido, aún sin iniciar la etapa SMTP. |
| `EN_PROCESO` | Marca durable previa a la posible llamada SMTP. |
| `ACEPTADO_SMTP` | El transporte aceptó el mensaje. No confirma entrega al buzón. |
| `FALLIDO` | Fallo conocido; puede ser transitorio o permanente. |
| `OMITIDO` | No se envía por configuración, falta de garantías u otra condición registrada. |
| `INCIERTO` | No se puede confirmar qué ocurrió con SMTP; no se reenvía automáticamente. |

Cada usuario se procesa de forma independiente, con captura de errores por usuario. Un fallo de SMTP o persistencia de uno no termina los demás informes. Las reservas y tokens también impiden dos envíos normales simultáneos desde procesos distintos.

La huella incluye el correo y las claves ordenadas de los tipos. Si cambia el correo o el alcance de un envío reservado/fallido, ese informe del día se omite con `CONFIGURACION_CAMBIADA`. No se redirige una reserva al nuevo correo ni se reutiliza contenido anterior. Al día siguiente se utiliza la configuración actual. Un informe ya aceptado mantiene su resultado y no se vuelve a enviar por cambiar el correo o los tipos. Una omisión también es terminal para ese usuario y fecha.

Antes de construir el mensaje se bloquean la fila de usuario, sus asignaciones y la reserva. Se vuelven a leer actividad, preferencia, dirección, tipos y garantías. La administración existente actualiza primero esa misma fila de usuario, por lo que sus cambios se ordenan respecto de la entrega a SMTP. Una retirada confirmada antes del bloqueo impide el envío. Si SMTP ya está en curso, el cambio espera a que termine esa sección; no puede deshacer un mensaje ya aceptado por un servidor externo.

La marca `EN_PROCESO` se confirma en una transacción anterior a SMTP. Así, una caída durante el envío no revierte la reserva a un estado reenviable. Solo se recupera automáticamente un `RESERVADO` abandonado durante 15 minutos; un `EN_PROCESO` abandonado se marca incierto. Un token anterior no puede iniciar otro envío después de que se recupere la reserva.

Se mantienen hasta cinco intentos por usuario y fecha, con cinco minutos de espera. Se reintentan rechazos temporales SMTP 4xx y fallos inequívocos de conexión anteriores al contenido. Los fallos permanentes no se reintentan. Un timeout o desconexión después de DATA, o sin evidencia de que ocurrió antes del contenido, se considera incierto. También queda incierto un mensaje que pudo aceptarse cuando falla guardar el resultado. No existe un botón de reenvío automático para estos casos: requieren revisión del proveedor y del historial.

La sección con bloqueos tiene tiempo acotado y el transporte individual configura límites de conexión, saludo y socket. SMTP y PostgreSQL no comparten una transacción de entrega; la estrategia evita reenvíos automáticos ante incertidumbre y nunca presenta aceptación SMTP como entrega confirmada.

## Retirada del mecanismo global

- El scheduler ya no importa la lista de destinatarios ni el almacén de reservas globales. Solo invoca el servicio individual.
- Se retiró el código que escribía reservas/intentos globales del repositorio operativo. Los modelos y datos `EnvioInformeCorreo`, `IntentoEnvioCorreo` y `ConfiguracionNotificaciones` permanecen intactos.
- `deliverDailyReport`, `deliverConfiguredDailyReport` y `sendManualConfiguredReport` fallan expresamente con `GLOBAL_REPORT_DISABLED`. No tienen acceso a un transporte.
- `email:report:test` y `scripts/email-report-test.ts` ahora ejecutan exclusivamente la vista previa segura. No verifican SMTP ni envían informes.
- `email:test` sigue siendo una prueba explícita de texto sintético sin pacientes dirigida a `EMAIL_TEST_TO`. No se ejecutó en esta etapa y no puede enviar un informe global.
- Alertas permanece en el menú, con la lista anterior en modo de consulta y un aviso de que ya no controla los envíos. Las rutas previas de configuración se conservan por compatibilidad; cambiar esa lista por API solo guarda datos históricos y no cambia los destinatarios individuales.

Antes de activar hay que detener todas las instancias o tareas que ejecuten versiones anteriores del backend. El código nuevo no activa ni ofrece un segundo mecanismo global.

## Vista previa y resultados

Desde `backend`:

```powershell
$env:AUTO_EMAIL_ENABLED = 'false'
npm.cmd run build
node dist/scripts/email-preview.js
# Fecha opcional:
node dist/scripts/email-preview.js --date 2026-11-05
# Alternativa con tsx en una terminal normal:
npm.cmd run email:preview -- --date 2026-11-05
```

La operación usa una transacción `READ ONLY` con snapshot repetible. Solo consulta configuración, nombres de garantías y conteos. No construye mensajes, no importa el servicio SMTP, no crea reservas ni modifica datos. Devuelve índices anónimos, cantidad de tipos, cantidad de garantías y motivos de exclusión por cuenta, además de totales.

Es una vista de **elegibilidad y contenido potencial**. No simula reservas ya aceptadas, intentos agotados ni la hora de ejecución. Un conteo potencial no garantiza que deba enviarse otra vez ese día. El campo `alcance` lo indica en la salida.

Rutas nuevas, ambas solo ADMIN:

| Ruta | Resultado |
| --- | --- |
| `GET /api/notificaciones/vista-previa-individual?fecha=AAAA-MM-DD` | Vista previa agregada, sin datos personales. |
| `GET /api/notificaciones/ultimos-resultados-individuales` | Último resultado individual por usuario y configuración de habilitación automática. Sin cuerpo de correo ni datos de pacientes. |

Gestión de usuarios conserva su tabla, preferencia y cantidad de tipos. Añade el resultado real más reciente, distinguiendo aceptación SMTP de entrega. Sin registros muestra esa ausencia; si aún no existe la tabla, comunica que el historial requiere migración. Un fallo de esta consulta no impide administrar las cuentas. Guardar configuración no envía correos.

## Verificación realizada

- Generación de cliente y validación de Prisma, typecheck y builds del frontend/backend.
- Suite completa: **221 pruebas en 31 archivos**, incluyendo las existentes de autenticación, usuarios, seguimiento, importaciones, áreas y correo. Las expectativas de la antigua edición de destinatarios en Alertas se actualizaron por su retirada intencional; no se ocultaron fallos.
- Pruebas unitarias de aislamiento entre A/B, tipo compartido, usuarios inactivos/deshabilitados/sin tipos/correo inválido, normalización, vencidas, exclusión por plazo, mensajes vacíos, fallo individual, concurrencia, revalidación de configuración, incertidumbre SMTP y bloqueo de entradas globales.
- Pruebas de API de fechas y permisos ADMIN, rechazo de los otros tres perfiles, ausencia de datos personales en preview y resultados honestos sin inventar entrega.
- Pruebas React del nuevo resultado SMTP y del estado con migración pendiente, además de los modales ya implementados. No se hizo un nuevo recorrido visual en navegador autenticado.
- **38 comprobaciones con PostgreSQL real aislado y SMTP simulado**: migración sobre historial global existente, cuenta ADMIN filtrada sin excepciones, usuarios y tipos compartidos, exclusión de cumplidas y normales, vencidas, fallos/reintentos, unicidad concurrente, cinco intentos, fallo permanente, cambios después de reservar, bloqueos durante SMTP, recuperación de reservas previas a SMTP, no reenvío de intentos inciertos, rollback al fallar guardar aceptación, APIs con sesiones auténticas de cuentas sintéticas e historial anterior intacto.
- La vista previa real de QA fue de solo lectura. No se aplicó la migración ni se escribieron usuarios, garantías, reservas o intentos en QA durante esta etapa.

Para repetir la integración, primero compilar y después ejecutar desde `backend`:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:individual-reports:postgres
```

El último comando crea y detiene un clúster temporal propio en puerto alto local, con identidad `ges_individual_reports_isolated`; no carga `.env` como conexión y rechaza otros destinos. Requiere los binarios de PostgreSQL 18, o indicar `-PostgresBin` al script PowerShell. Conserva archivos temporales de diagnóstico y no elimina directorios ni toca QA.

## Pasos pendientes antes de activar

1. Revisar esta implementación y autorizar específicamente la aplicación de `20261105120000_individual_email_reports` en QA. Mantener `AUTO_EMAIL_ENABLED=false`. No utilizar la autorización anterior como permiso para esta migración.
2. Con la API detenida, comprobar conexión y migraciones. Tras la autorización, aplicar con `npm.cmd run prisma:deploy`, regenerar Prisma y ejecutar typecheck/build. No usar reset ni db push. Los datos globales anteriores deben seguir presentes.
3. Con el correo aún apagado, iniciar la API y revisar usuarios activos, correo, recepción habilitada y tipos. Ejecutar la vista previa; comprobar sus conteos frente a las asignaciones. Revisar la nueva columna de resultados y confirmar que no hay un proceso antiguo ni una tarea de envío global en ejecución.
4. Antes de la puesta en marcha, verificar SMTP/remitente con el procedimiento operativo autorizado. La vista previa no prueba conectividad SMTP. Si se necesita una prueba sintética, debe ser una acción explícita y separada del procesamiento de informes con pacientes.
5. Solo después de verificar y autorizar los envíos reales, configurar `AUTO_EMAIL_ENABLED=true`, conservar la hora civil deseada en `AUTO_EMAIL_TIME` y reiniciar **una instancia supervisada** del backend antes de esa hora. Si arranca tarde, solo procesa reservas individuales ya existentes; sin ellas espera al día siguiente. La lista de Alertas no se utiliza.
6. Supervisar resultados e intentos individuales. `ACEPTADO_SMTP` no acredita llegada a la bandeja. Investigar los estados inciertos antes de considerar cualquier intervención manual; no borrar reservas para forzar reenvíos.

No se activó este procedimiento durante la implementación.

## Archivos principales

- Prisma: `backend/prisma/schema.prisma` y `backend/prisma/migrations/20261105120000_individual_email_reports/migration.sql`.
- Servicio/repositorio nuevos: `backend/src/modules/notificaciones/individual-report-{service,repository}.ts`.
- Adaptaciones: scheduler, servicio SMTP, formateadores/entradas globales bloqueadas, repositorio antiguo solo de lectura y rutas de notificaciones.
- CLI: `backend/scripts/email-preview.ts`, alias `email-report-test.ts`, `backend/package.json` y runner de integración `check-individual-reports-postgres.{ts,ps1}`.
- Interfaz: `src/services/notificaciones.ts`, `src/pages/GestionUsuarios.tsx`, texto del formulario `src/components/UserEditor.tsx` y sección Alertas dentro de `src/pages/pages2.tsx`.
- Documentación y pruebas: este documento, README de backend, ejemplo de entorno y suites de reportes, rutas y UI. No se añadieron dependencias de ejecución.
