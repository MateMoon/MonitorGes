# Seguimiento de gestión — primera etapa de integración

Fecha: 3 de noviembre de 2026. Destino: Monitor de Garantías GES original.

## Resultado y estado de entrega

Se implementaron las fases A–D: modelo y lógica transaccional; Dashboard, filtros e informes; interfaz de seguimiento; pruebas y compatibilidad.

**El código está preparado; la nueva migración NO se aplicó a QA.** Se aplicó y verificó solamente en una instancia PostgreSQL 18 temporal y aislada, con datos sintéticos de prueba, directorio y puerto propios. El runner detuvo esa instancia al finalizar. No se usó la conexión de QA, no se inició el servidor HTTP ni su programador, y no se enviaron correos.

La activación funcional en QA requiere aplicar primero la migración autorizada y desplegar backend y frontend compatibles. No debe ponerse en servicio el nuevo backend contra el esquema anterior.

La referencia visual fue `MonitorGES2/src/pages3.tsx` y las etiquetas/colores de `MonitorGES2/src/store.tsx`. Se conservaron las pantallas originales y no se incorporó el store simulado.

## Funcionalidades implementadas

- Cuatro estados persistentes: `SIN_GESTION`, `EN_GESTION`, `PENDIENTE_RESOLUCION`, `CUMPLIDA`.
- Seis tipos de actuación, comentario opcional, autor de sesión y fecha del servidor.
- Historial individual de actuaciones, cambios de estado, cumplimiento, reapertura y antecedente legado.
- Cambio automático de SIN_GESTION a EN_GESTION al registrar la primera actuación.
- Conservación de PENDIENTE_RESOLUCION al registrar nuevas actuaciones.
- Cumplimiento explícito con respaldo textual obligatorio.
- Reapertura explícita con motivo obligatorio y destino PENDIENTE_RESOLUCION.
- Cuatro tarjetas de seguimiento adicionales en Dashboard, con conteos del backend.
- Filtro independiente de gestión y distintivos en el listado, conservando los filtros existentes.
- Separación de indicadores de plazo operativos: excluyen cumplidas. Los indicadores de gestión abarcan todas las garantías.
- Exclusión de cumplidas en la selección del informe operativo por correo.

Las cinco categorías de plazo se conservan sin alterar sus rangos ni fechas. Atención realizada es una actuación y no acredita cumplimiento automáticamente. Ninguna operación de seguimiento modifica fecha de inicio, fecha límite, responsable, versión de importación ni `updatedAt` de datos fuente.

## Modelos y migración

`Garantia` agrega:

| Campo | Función |
| --- | --- |
| `estadoGestion` | Enum de cuatro estados, predeterminado SIN_GESTION |
| `revisionGestion` | Entero inicial 0; aumenta con cada operación para detectar solicitudes obsoletas |
| `eventos` | Relación con la cronología |

Se conservan `gestionadaAt` y `gestionadaPorUsuarioId`. Las nuevas actuaciones y operaciones explícitas actualizan esos campos de compatibilidad con la fecha y el autor de la última operación registrada. Las fechas se guardan con tratamiento UTC consistente entre SQL y Prisma y se muestran en horario de Santiago.

Nuevo modelo `EventoGarantia`:

- UUID y secuencia única creciente.
- Garantía relacionada y usuario autor, con nombre conservado en el evento.
- Categoría, tipo de actuación cuando existe, comentario y respaldo.
- Estado anterior y nuevo cuando corresponde, y fecha del evento.
- Clave única para el antecedente legado y metadatos opcionales para extensiones futuras.

Enums nuevos: `EstadoGestion`, `TipoActuacion` y `TipoEventoGarantia`. Se añadió la relación inversa en `Usuario`.

Migración: [20261103120000_guarantee_management_timeline](backend/prisma/migrations/20261103120000_guarantee_management_timeline/migration.sql).

La migración usa una transacción. No borra ni reconstruye tablas existentes. Las garantías sin gestión conocida quedan SIN_GESTION y sin eventos inventados. Las que tienen `gestionadaAt` quedan EN_GESTION y reciben un único ANTECEDENTE_LEGADO con su fecha y autor originales; no se inventa tipo, comentario ni cumplimiento. La clave e ID deterministas impiden duplicar ese antecedente. No se usa un respaldo anterior como cumplimiento vigente tras reabrir.

Se agregan índices para filtros y cronología y restricciones SQL que exigen respaldo en eventos de cumplimiento, motivo en reapertura y tipo en actuaciones. Las futuras categorías de reasignación, apoyo o revisión podrán añadirse al enum y usar metadatos mediante otra migración; no se implementaron operaciones de esas categorías.

## API y autorización

| Ruta | Comportamiento | Permiso |
| --- | --- | --- |
| `POST /api/garantias/:id/gestion` | Registra actuación; ahora exige tipo y revisión | ADMIN y PROFESIONAL |
| `POST /api/garantias/:id/estado-gestion` | Cambia a EN_GESTION, PENDIENTE_RESOLUCION o CUMPLIDA | ADMIN |
| `POST /api/garantias/:id/reabrir` | Reabre CUMPLIDA a PENDIENTE_RESOLUCION | ADMIN |
| `GET /api/garantias/:id` | Incluye estado, revisión y cronología ordenada | Sesión autenticada |
| `GET /api/garantias` | Añade `estadoGestion` y `soloPendientes` al filtrado paginado | Sesión autenticada |
| `GET /api/dashboard` | Añade conteos por gestión y total operativo | Sesión autenticada |

Ejemplos de cuerpos JSON, sin datos personales:

```json
{ "tipoActuacion": "CONTACTO_PACIENTE", "comentario": "Comentario opcional", "revisionGestion": 0 }
```

```json
{ "estadoGestion": "CUMPLIDA", "respaldo": "Referencia al respaldo verificado", "revisionGestion": 1 }
```

```json
{ "motivo": "Se requiere una nueva revisión", "revisionGestion": 2 }
```

`revisionGestion` se toma del detalle vigente. La ruta de actuaciones anterior ya no admite una solicitud sin tipo ni revisión; el cliente original se actualizó conjuntamente. Los campos antiguos de lectura se conservaron.

Las validaciones rechazan campos desconocidos y no aceptan autor o fecha proporcionados por el navegador. Se limitan comentarios, respaldo y motivo a 4.000 caracteres y se rechazan motivos o respaldos compuestos solo de espacios.

Los guards de Fastify son obligatorios. Además, el repositorio vuelve a comprobar el rol. No se ampliaron permisos a COORDINADOR_SOME o LECTOR; PROFESIONAL conserva actuaciones y no recibe cambios explícitos de estado. Todos esos cambios explícitos se reservan inicialmente a ADMIN, además del cumplimiento y reapertura exigidos como exclusivos de ADMIN.

Cada escritura bloquea la fila de la garantía, comprueba su revisión y realiza evento y actualización en la misma transacción. Una revisión obsoleta devuelve `409`; la pantalla ofrece recargar el detalle. Esto también evita aplicar dos veces solicitudes concurrentes con una misma revisión.

Se rechazan cambios al estado actual, actuaciones sobre CUMPLIDA y reaperturas de garantías no cumplidas. No existe transición a SIN_GESTION que borre el trabajo anterior.

La cronología se devuelve con `createdAt DESC, secuencia DESC`: más reciente primero y orden estable para eventos del mismo instante. No existen rutas de edición o borrado de eventos.

## Cambios visibles

### Dashboard

Se mantienen las cinco tarjetas de plazo, identificadas como garantías no cumplidas, y se añade una sección de cuatro tarjetas de seguimiento con los colores del diseño de referencia. Los conteos se calculan mediante consultas a PostgreSQL, no a partir de una página del listado.

Las tarjetas de gestión abren el listado con todos los plazos, incluidas vencidas, y `soloPendientes=false`. Las tarjetas de plazo y «Ver todas» de urgentes envían `soloPendientes=true`. Así coinciden las poblaciones contadas y las consultadas.

La tabla de urgentes conserva el criterio original de vencidas o límite dentro de siete días y orden por fecha límite, ahora excluyendo cumplidas y con desempate por ID. No se reemplazó por la distinta selección de urgentes del diseño de referencia.

Los datos vuelven a consultarse al regresar al Dashboard tras una operación. No se añadieron sondeo periódico ni sincronización en tiempo real entre navegadores.

### Listado Garantías

Se añadió Estado de gestión: Todos, Sin gestión, En gestión, Pendiente de resolución y Cumplida. Puede combinarse con plazo, búsqueda y demás filtros. Cambiar ese filtro manualmente conserva la selección de plazos; las entradas desde las tarjetas de gestión del Dashboard establecen todos los plazos para coincidir con sus conteos. El selector y los chips permiten acotar después la consulta.

La casilla «Solo pendientes operativas» hace explícita la exclusión de cumplidas y se desmarca al seleccionar Cumplida. El listado sigue paginado en el servidor. En cada paciente se muestra el distintivo del estado de gestión.

### Detalle

Se mantienen paciente, datos fuente y estado de plazo. Se añade una sección de seguimiento con estado de gestión, formulario de actuación y cronología.

ADMIN dispone también del formulario de cambio de estado y, cuando está cumplida, de reapertura. El respaldo se muestra como vigente solo mientras la garantía está CUMPLIDA; después queda como antecedente en su evento histórico. Los perfiles de consulta pueden leer la cronología.

Tras una respuesta satisfactoria se incorpora el evento devuelto por el servidor, sin inventar fechas o autores. Un error conserva un mensaje visible y no anuncia éxito. Se bloquean envíos repetidos mientras una operación está pendiente.

## Efecto sobre informes e importaciones

La única modificación al mecanismo de correo es el `where` de selección: `estadoGestion != CUMPLIDA`, manteniendo la condición de fecha límite hasta hoy más 30 días. EN_GESTION y PENDIENTE_RESOLUCION siguen siendo elegibles según plazo. Reabrir recupera esa elegibilidad. No se alteraron destinatarios, SMTP, horarios, formateadores, reintentos ni programador.

El importador Excel no se modificó: las nuevas garantías reciben SIN_GESTION por defecto de base y las actualizaciones de campos fuente no sobrescriben estado, revisión ni eventos. Se conserva la limitación existente de identidad provisional de episodios; esta etapa no agrega una bandeja de revisión ni nuevas reglas de importación.

## Archivos modificados o creados

| Grupo | Archivos |
| --- | --- |
| Modelo | `backend/prisma/schema.prisma` |
| Migración nueva | `backend/prisma/migrations/20261103120000_guarantee_management_timeline/migration.sql` |
| Reglas y repositorio nuevos | `backend/src/modules/garantias/management.ts`, `management-repository.ts` |
| API de garantías | `backend/src/modules/garantias/schema.ts`, `repository.ts`, `service.ts`, `controller.ts`, `routes.ts` |
| Dashboard | `backend/src/modules/dashboard/repository.ts`, `service.ts` |
| Selección de informes | `backend/src/modules/notificaciones/email-report-repository.ts` |
| Tipos y presentación cliente | `src/types/index.ts`, `src/management.ts` |
| Servicios cliente | `src/services/garantias.ts`, `src/services/dashboard.ts` |
| Navegación y Dashboard | `src/App.tsx`, `src/pages/pages1.tsx` |
| Listado y detalle | `src/pages/GuaranteesPage.tsx`, nuevo `src/pages/SeguimientoGarantia.tsx` |
| Pruebas | `backend/test/guarantee-management-repository.test.ts`, `guarantee-management-ui.test.ts`, `routes.test.ts`, nuevo `management-projections.test.ts` |
| Integración aislada | `backend/scripts/check-management-postgres.ps1`, `check-management-postgres.ts`, `postgres-test-control.cjs` |
| Entrega | Este documento |

No se cambiaron login, usuarios, configuración, áreas, importador ni historial de importaciones. No se crearon commits. La generación del cliente Prisma fue local y no aplicó migraciones.

## Pruebas y resultados

Las ejecuciones se realizaron con `AUTO_EMAIL_ENABLED=false`.

| Verificación | Resultado |
| --- | --- |
| Generación del cliente Prisma | Correcta; sin migración de QA |
| Typecheck frontend | Correcto |
| Typecheck backend | Correcto |
| Build frontend | Correcto; conserva la advertencia preexistente de compatibilidad futura de configuración Vite |
| Build backend | Correcto |
| Suite específica de seguimiento, proyecciones y rutas | 33 pruebas aprobadas |
| Suite completa | 175 aprobadas y 2 fallidas de 177 |
| PostgreSQL 18 aislado con SQL de migraciones y repositorios reales | Correcto |
| Fastify mediante `inject`, sesiones y PostgreSQL aislado reales | Correcto; sin servidor HTTP escuchando |
| Navegador autenticado sobre QA | Pendiente de autorización, migración y despliegue |

Los dos fallos de la suite completa ya existían antes de esta etapa en `frontend-navigation.test.ts`: esperan el literal `type="email" required` y textos explicativos antiguos de Alertas. Se conservaron esas pruebas y el componente ajeno a esta etapa; no son fallos nuevos del seguimiento. La suite completa no se declara aprobada.

Cobertura de los 18 requisitos de prueba:

| Requisito | Evidencia |
| --- | --- |
| 1. Nueva garantía SIN_GESTION | Default verificado mediante INSERT/Prisma real en instancia aislada |
| 2–5. Primera y segunda actuación, pendiente y atención realizada | Repositorio simulado y PostgreSQL aislado |
| 6–9. Respaldo, actuaciones conservadas, motivo y reapertura histórica | Validadores, repositorio y PostgreSQL aislado |
| 10. Plazo intacto | Comparación de fechas fuente antes/después y compatibilidad de última gestión |
| 11. Conteos reales de tarjetas | Repositorio de Dashboard, consultas reales y comparación con API de listado |
| 12. Filtros combinados y paginación | Suite de proyecciones y consultas PostgreSQL |
| 13. Navegación sin exclusión de vencidas | Prueba del preset que consume Dashboard y su consulta real de filtros |
| 14–15. Cumplidas fuera del informe, EN_GESTION dentro según plazo | Selección de informes con doble de Prisma y PostgreSQL real aislado |
| 16. Permisos Fastify | Matriz de roles en rutas y rechazo real de cambio de estado a profesional con sesión persistida |
| 17. Datos anteriores compatibles | Siete migraciones anteriores, registros previos y aplicación de nueva migración en clúster aislado |
| 18. Fallo sin estado/evento parcial | Dobles transaccionales y trigger PostgreSQL temporal que fuerza un fallo después de insertar el evento |

Además se verificaron concurrencia real de dos solicitudes con la misma revisión, persistencia al desconectar/reconectar, orden estable para eventos con la misma fecha, autor de sesión y ausencia de duplicación del antecedente legado.

Para repetir la prueba aislada en Windows, con PostgreSQL instalado y permisos para iniciar procesos propios, desde `backend`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-management-postgres.ps1
```

El parámetro `-PostgresBin` permite indicar otra carpeta de binarios. El runner crea una instancia nueva en una carpeta temporal, usa un puerto aleatorio entre 55000 y 59998, fuerza correo deshabilitado y la detiene en `finally`. El comprobador exige el nombre de base y marcador de clúster aislados; no toma la conexión de QA como destino. Conserva los archivos temporales de diagnóstico, pero no deja el servidor en ejecución cuando termina correctamente. No crea un servicio Windows.

## Aplicación controlada en QA — solo después de autorización posterior

**Estos pasos están documentados, no ejecutados en QA.**

1. Confirmar autorización, respaldo recuperable y nombre exacto de la base QA. Identificar explícitamente el destino sin imprimir credenciales. Revisar el historial de migraciones y que no existan otras pendientes sin aprobar.
2. Detener el backend y reservar la ventana de aplicación. Evitar que un proceso anterior siga escribiendo gestiones mientras se aplica el cambio; ese código anterior no crea eventos y no debe volver a usarse tras el despliegue.
3. Usar una consola dedicada en `backend` con `DATABASE_URL` configurada expresamente para esa base QA. Mantener `AUTO_EMAIL_ENABLED=false` para las comprobaciones. No ejecutar `seed`, `db push`, `migrate reset` ni scripts SMTP.
4. Revisar el archivo SQL nuevo: incluye backfill de estado y un antecedente por garantía previamente gestionada. No reinterpretar el antecedente como un cumplimiento.
5. Comprobar y aplicar con detención ante cualquier error:

```powershell
# Ejecutar únicamente en la consola conectada a QA, después de aprobar el cambio.
$env:AUTO_EMAIL_ENABLED = 'false'
npm.cmd exec -- prisma migrate status
if ($LASTEXITCODE -ne 0) { throw 'Revisar el estado y las migraciones pendientes antes de continuar.' }
# migrate deploy aplica TODAS las pendientes: confirmar previamente el listado aprobado.
npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Falló la aplicación de migraciones; no iniciar el backend.' }
npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Falló la generación del cliente.' }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Falló typecheck.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Falló build del backend.' }
```

`prisma migrate status` puede señalar que hay migraciones pendientes y devolver un código distinto de cero; eso exige revisar su listado antes de continuar deliberadamente. No ejecutar el bloque completo sin esa revisión.

6. Compilar el frontend desde la raíz con `npm.cmd run build` y desplegar ambos componentes de la misma versión. Iniciar el backend únicamente bajo el procedimiento autorizado, con correo automático deshabilitado para el recorrido QA.
7. Verificar conteos de pacientes/garantías antes y después, estado inicial, antecedentes legados únicos y conservación de las fechas y gestores anteriores. Confirmar la migración en `_prisma_migrations`.
8. Ejecutar los pasos de navegador siguientes y revisar logs sin publicar información personal. No probar correo real como parte de esta etapa.

Si hay que revertir un despliegue después de crear eventos, detener escrituras y utilizar el respaldo/procedimiento de recuperación aprobado. No borrar la tabla de eventos ni volver a una versión que sobrescriba silenciosamente el seguimiento.

## Comprobación en navegador tras aplicar la migración autorizada

1. Ingresar como ADMIN. Ver las cinco tarjetas de plazo y las cuatro de gestión, con secciones separadas.
2. Pulsar cada tarjeta de gestión y comparar su cantidad con el total de resultados del listado; verificar que el filtro de plazo incluya vencidas.
3. Abrir una garantía SIN_GESTION, registrar Contacto con el paciente y comprobar EN_GESTION, evento con autor/hora del servidor y mensaje de confirmación.
4. Registrar otra actuación y comprobar que ambas sigan visibles. Probar Atención realizada y confirmar que no quede CUMPLIDA ni cambie el plazo.
5. Cambiar explícitamente a PENDIENTE_RESOLUCION; registrar una actuación y confirmar que conserve ese estado.
6. Intentar cumplir sin respaldo: el formulario debe impedirlo y la API también debe rechazarlo. Completar con respaldo y comprobar su presentación vigente y los eventos anteriores.
7. Volver a Dashboard: la tarjeta Cumplida debe aumentar y los indicadores operativos de plazo deben excluir esa garantía. Consultarla expresamente como Cumplida, incluso si está vencida.
8. Reabrir con motivo obligatorio. Confirmar PENDIENTE_RESOLUCION, respaldo anterior solo en el historial y posibilidad de continuar registrando actuaciones.
9. Recargar, cerrar/abrir sesión y consultar de nuevo: estado y cronología deben persistir.
10. Ingresar como PROFESIONAL: registrar actuaciones sobre una no cumplida; comprobar que no disponga de cambios explícitos, cumplimiento o reapertura. En CUMPLIDA debe requerir reapertura por ADMIN.
11. Ingresar como LECTOR o COORDINADOR_SOME: comprobar consulta sin escrituras de seguimiento.
12. En dos pestañas, abrir la misma revisión; guardar en una e intentar guardar en la otra. La segunda debe recibir conflicto y ofrecer recargar, sin duplicar eventos.
13. Combinar plazo y gestión, nombre/RUT, responsable y paginación. Verificar que los filtros sigan ejecutándose en backend.

No se necesita ni debe enviarse un correo para comprobar la elegibilidad: esa selección está cubierta por las pruebas automatizadas y la instancia aislada.

## Pendientes y límites

- Autorización y aplicación en QA; recorrido autenticado de navegador y validación de su despliegue.
- Dos pruebas textuales preexistentes de Alertas siguen fallando en la suite global.
- La cronología devuelve todos los eventos de una garantía y se desplaza visualmente; no se incorporó paginación del historial en esta etapa.
- El respaldo es textual. No se implementaron archivos adjuntos, verificación externa de documentos ni firma de acreditación.
- No se implementaron asignación, reasignación, apoyos, revisión de importaciones, supervisión, informes por funcionario ni estadísticas históricas.
- No se habilitaron nuevos permisos globales para profesionales, coordinadores o lectores, ni se modificó el módulo de áreas retirado de la interfaz.
