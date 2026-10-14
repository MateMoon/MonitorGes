# Auditoría del Monitor de Garantías GES

**Fecha:** 14 de octubre de 2026  
**Alcance:** inspección estática del frontend, backend, Prisma, scripts, ejemplos de entorno, documentación y pruebas; `npm test`, chequeo de tipos y builds locales. No se conectó a PostgreSQL, no se ejecutaron migraciones, no se modificó ningún dato y no se envió correo ni se habilitó el programador.

## A. Resumen ejecutivo

El repositorio ya no es solo una demo: hay autenticación con contraseñas `scrypt` y sesiones en PostgreSQL; Dashboard y listado/detalle de garantías leen la API; la importación Excel valida y persiste; y se puede guardar en PostgreSQL el destinatario del informe automático. El backend protege estas rutas con sesión y aplica roles a importaciones y a la edición del destinatario.

La aplicación todavía presenta pantallas y señales de demo junto a esa funcionalidad real. El feed y el timbre del Dashboard, Estadísticas, buena parte de Alertas y Configuración/Usuarios muestran constantes o estado local. Algunas de esas señales describen actividad inexistente o contradicen el estado operativo. No se debe interpretar el botón de guardar en esos módulos como persistencia.

Los riesgos prioritarios antes de datos reales son: una clave provisional de garantía que no identifica con certeza registros de negocio; registros de importación sin usuario asociado y sin endpoint para consultar sus errores; acciones de gestión que solo viven en memoria; falta de APIs de administración y de bandeja real; permisos de lectura amplios para datos personales; y comportamiento de correo que requiere operación y recuperación documentadas. Se observó mojibake en mensajes y documentación, no solo en una pantalla.

### Comprobaciones ejecutadas

| Comando | Resultado |
| --- | --- |
| `cd backend; npm.cmd test` | Correcto: 14 archivos, 76 pruebas. Son pruebas unitarias/de ruta con dependencias simuladas; no demuestran integración con una base PostgreSQL real ni con SMTP. |
| `cd backend; npm.cmd run typecheck` | Correcto. |
| `cd backend; npm.cmd run build` | Correcto: compilación TypeScript. |
| `npm.cmd run build` en la raíz | Correcto: build Vite. Vite mostró avisos de compatibilidad de `configLoader: 'native'` en `vite.config.ts` (`__dirname` y el import JSON sin atributos); no impidieron el build. |

No se ejecutaron `prisma migrate`, `prisma db push`, `seed`, scripts de provisión, pruebas E2E ni comandos de correo. La auditoría no verifica el estado real de migraciones ni el contenido de QA.

## B. Matriz de pantallas y módulos

| Pantalla/módulo | Estado | Evidencia y conexión real | Qué falta exactamente | Pruebas necesarias |
| --- | --- | --- | --- | --- |
| Inicio de sesión/sesión | **Funcional, con endurecimiento pendiente** | `src/pages/pages1.tsx`; `src/services/auth.ts`; `backend/src/modules/auth/{routes,auth-service}.ts`; `Usuario.passwordHash`, `SesionUsuario`. Login, `/me`, logout, cookie HttpOnly/SameSite, vencimiento y revocación se consultan en backend. | Medir expiración con navegador abierto; decidir cierre de sesiones ante cambios de permisos/credenciales fuera del script de provisión; mover o compartir rate limit entre réplicas. `ultimoAccesoAt` no se actualiza. | E2E de login, sesión expirada/revocada, usuario desactivado y roles; pruebas con reloj controlado y despliegue multiinstancia. |
| Dashboard | **Parcial** | `src/pages/pages1.tsx`; `src/services/dashboard.ts`; `backend/src/modules/dashboard/*`. Conteos, garantías urgentes y última importación vienen de Prisma. El feed lateral es constante en el componente. `src/App.tsx` imprime una hora fija y el timbre presenta tres avisos ficticios. El estado “Monitoreo automático activo” aparece aunque la automatización esté apagada. | Conectar actividad a una API persistida, sustituir hora fija y avisos, y mostrar estado operativo del backend. La lista urgente incluye vencidas (`fechaLimite <= hoy + 7`) aunque el texto diga “no vencidas”. | Comparar conteos/lista con consultas SQL de solo lectura en QA; probar días límite y que el texto/lista coincidan; comprobar estados del programador apagado/encendido. |
| Garantías y detalle | **Parcial, lectura real** | `src/pages/GuaranteesPage.tsx`; `src/services/garantias.ts`; `backend/src/modules/garantias/*`; modelo `Garantia` relacionado con `Paciente`. Búsqueda, filtros, orden, paginación, opciones y detalle usan endpoints protegidos y PostgreSQL. | “Marcar como gestionada” solo actualiza un `Set` de React en `App.tsx`; se pierde al navegar/recargar y no registra usuario. El detalle declara explícitamente que el historial de notificaciones aún no está disponible. | E2E de filtros combinados/paginación/detalle; prueba de persistencia y autorización al gestionar; comparación de conteos/filtros en límites de fecha. |
| Importar nómina | **Funcional con riesgos de identidad y recuperación** | `src/pages/pages2.tsx`; `src/services/importaciones.ts`; `backend/src/modules/importaciones/{routes,validation-service,import-service}.ts`. ExcelJS lee la primera hoja; detecta encabezados entre filas 1–30; valida columnas, RUT/DV y fechas; previsualiza y luego procesa filas válidas con transacción individual, guardando errores y conteos. ADMIN/PROFESIONAL pueden validar/importar. | La identidad de garantía es provisional: RUT + fecha de inicio + problema/nombre normalizados; sin ID estable, los cambios de esos campos pueden crear duplicados y varias coincidencias se rechazan como ambiguas. El número de días Excel, aunque no determina estado, sigue siendo obligatorio y debe ser entero. Si falla la escritura de un error de fila después de un fallo de BD, el proceso puede quedar sin estado final. La importación no guarda `usuarioId`. | Prueba QA con dos importaciones idénticas, datos cambiados, duplicados/ambigüedades y errores parciales; fallos de BD/transacción; RUT con formatos reales; fechas seriales Excel/1904; archivo con encabezados tardíos y filas vacías. Acordar clave estable antes de datos reales. |
| Historial de importaciones | **Parcial** | `Historial` en `src/pages/pages2.tsx`; `GET /api/importaciones` y `listImports()` leen PostgreSQL. | La columna Usuario siempre es `—`; la creación no asigna el usuario autenticado. “Ver detalle” solo abre los campos de la fila ya cargada. No existe `GET /api/importaciones/:id` ni consulta de errores detallados aunque `ErrorImportacion` los persiste. | E2E de paginación/orden y errores; confirmar atribución de actor; comprobar que errores no exponen innecesariamente datos de pacientes. |
| Alertas | **Parcial: configuración del destinatario real; reglas y bandeja mock** | `src/pages/pages2.tsx`; `src/services/notificaciones.ts`; `/api/notificaciones/configuracion-correo` GET/PUT; `ConfiguracionNotificaciones`. Email se normaliza/valida y persiste. Solo ADMIN puede actualizarlo. | Los checks de reglas, frecuencia y tipos de aviso solo cambian estado local; “Guardar cambios” solo muestra un toast. La bandeja usa `NOTIFS` de `src/data/mockData.ts`. No existen APIs `/api/notificaciones` de bandeja ni `/api/alertas`. | Pruebas E2E de lectura/guardado y rechazo por rol; pruebas de que la bandeja represente intentos reales y filtros; contract tests API/UI. |
| Informe automático por correo | **Implementado en backend; operación no verificada** | `backend/src/server.ts` inicia el scheduler; `email-report-scheduler.ts`, `report-service.ts`, `email-report-repository.ts`; modelos `EnvioInformeCorreo` e `IntentoEnvioCorreo`. Corre en el proceso backend aunque se cierre el navegador; por defecto `AUTO_EMAIL_ENABLED=false`. Usa fecha `America/Santiago`, reclama fecha única y registra reintentos. | No se probó con SMTP ni DB. El proceso depende de que el backend esté activo y de una sola instancia operativa/manejo correcto de réplicas. Hay una ventana posible de duplicado si SMTP acepta el correo y el proceso cae antes de registrar éxito; correo y PostgreSQL no comparten transacción. Estado/historial real de entregas no se expone en UI/API. Definir alertas de salud, rotación de credenciales, destinatario, política de reintentos y respuesta a cambios de destinatario. | Pruebas de integración SMTP sandbox y DB QA; fallo antes/después de aceptación SMTP, reinicio, reserva concurrente y cambio de destinatario; prueba de despliegue supervisado. No activar envío en producción para probar. |
| Estadísticas | **Mock/demo y actualmente inaccesible** | `Estadisticas` y gráficas en `src/pages/pages2.tsx`; usa `CONTEOS`, `GARANTIAS_DATA`, `NEXT30`, `EVO`. En `src/App.tsx` el elemento del menú y el render están comentados/deshabilitados. | Exponer la pantalla solo tras conectar consultas y definir períodos/métricas; datos y fecha actuales son ficticios. | Pruebas de agregaciones contrastadas con consulta SQL; período, zona horaria y navegación. |
| Configuración/Usuarios | **Mock/demo** | `Configuracion` en `src/pages/pages2.tsx`; catálogos y usuarios vienen de `src/data/mockData.ts`. Rangos se guardan en estado React y toast; modal de usuario informa “agregado (simulado)”. | No hay rutas/API `/api/configuracion` o `/api/usuarios`, ni persistencia ni administración web. Roles aplicados hoy no equivalen a los nombres de demo “Administrador/Operador/Consulta”; backend usa ADMIN/PROFESIONAL/LECTOR. | E2E de persistencia y control de permisos cuando se implemente; reconciliar catálogo de roles y formularios con política institucional. |
| Login, importación y gestión en servicios | **Conectados al backend** | `src/services/api.ts` envía cookies con `credentials: 'include'`; adaptadores auth, dashboard, garantías, importación y destinatario. | Añadir cancelación/timeouts donde corresponda, manejo común de sesión expirada y pruebas de contrato. | Contract tests frontend-backend y E2E en QA aislado. |

## C. Inventario de mocks y datos locales

| Ubicación | Uso actual | Recomendación |
| --- | --- | --- |
| `src/data/mockData.ts` (`GARANTIAS_DATA`, `CONTEOS`, `IMPORTS`, `NOTIFS`, `USUARIOS`, catálogos) | Datos ficticios construidos con nombres/RUT sintéticos; `NOTIFS`, conteos, estadísticas, configuración/usuarios se importan en pantallas activas. | Mantener fixtures claramente delimitados para pruebas; retirar de las vistas operativas al implementar sus endpoints. No sustituir silenciosamente la API con estos fixtures ante error. |
| `src/pages/pages1.tsx` feed de `Dashboard` | Cuatro eventos hardcodeados de Excel/correos/revisión automática. | Reemplazar con actividad persistida o eliminar el bloque; no presentar como hecho actual. |
| `src/App.tsx` cabecera/timbre | Fecha fija `06/10/2026 08:32`; tres notificaciones hardcodeadas, contador `3`. | Usar timestamps/eventos del backend o retirar indicador. |
| `src/pages/pages2.tsx` `Alertas` | Reglas/checks/frecuencia en estado local; bandeja desde `NOTIFS`. La tarjeta superior del destinatario sí lee estado real. | Separar visualmente datos de demo hasta conectar APIs; retirar botones que simulan guardado. |
| `src/pages/pages2.tsx` `Estadisticas`, `Configuracion` | Series, conteos, usuarios y campos editables locales; usuario simulado. Estadísticas no está navegable actualmente. | No habilitar hasta conectar persistencia/métricas. |
| `src/pages/GuaranteesPage.tsx` gestión en `App.tsx` | El flag `gestionadas` vive únicamente durante la sesión del componente raíz. | Persistir la gestión con actor y fecha o quitar/rotular la acción. |
| `backend/test/*.test.ts` | Mocks de Prisma, SMTP, reloj y datos sintéticos en pruebas unitarias/rutas. | Mantener; complementar con una suite de integración aislada. Las pruebas mock no certifican operación con servicios reales. |

## D. API, datos, seguridad y reglas de negocio

### Endpoints existentes y correspondencia

| Endpoint | Uso y autorización |
| --- | --- |
| `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` | Login, restauración de sesión y cierre; login público, los otros requieren sesión. |
| `GET /api/garantias`, `GET /api/garantias/opciones-filtros`, `GET /api/garantias/:id` | Lista/filtros/detalle; requieren sesión, lectura para los tres roles. No existe escritura de gestión. |
| `GET /api/dashboard` | Resumen y última importación; requiere sesión. No hay feed de actividad. |
| `GET /api/importaciones`, `POST /api/importaciones/validar`, `POST /api/importaciones` | Historial (lectura con sesión), validar y aplicar (ADMIN/PROFESIONAL). No hay endpoint de detalle/errores. |
| `GET/PUT /api/notificaciones/configuracion-correo` | Configuración real del destinatario; GET requiere sesión, PUT requiere ADMIN. |

No se encontraron APIs de listado/gestión de usuarios, configuración de rangos GES, reglas de alerta, bandeja de notificaciones, historial de notificación por garantía ni gestión de garantía. No inferir su existencia desde el UI.

### Prisma y persistencia

`backend/prisma/schema.prisma` contiene `Paciente`, `Garantia`, `Usuario`, `SesionUsuario`, `Importacion`, `ErrorImportacion`, `ConfiguracionNotificaciones`, `EnvioInformeCorreo` e `IntentoEnvioCorreo`. Paciente tiene unicidad por RUT/DV; hay índices en fecha límite, responsable, relaciones e importaciones/sesiones; las reservas de informe son únicas por fecha y los intentos por envío/número. Las relaciones usan restricciones explícitas (`Restrict`, `Cascade`, `SetNull`).

`Garantia` no tiene una clave natural única de caso de origen ni restricción contra una garantía duplicada. La clave usada por la importación se calcula en servicio y es provisional. Tampoco hay modelo de evento de gestión; `gestionadaAt` y `gestionadaPorUsuarioId` sí existen, pero ninguna ruta los actualiza. `Importacion.usuarioId` admite actor, pero el código de creación no lo rellena. La retención/eliminación de archivos fuente no aplica porque no se almacena el binario; sí se guardan nombre, conteos y errores de fila.

### Reglas GES

El cálculo del backend usa `fechaLimite`, convierte hoy a fecha civil mediante `TIME_ZONE` (por defecto `America/Santiago`) y usa días civiles: vencida `< 0`, crítica `0–7`, próxima `8–15`, atención `16–30`, normal `>=31`. Dashboard, filtro por estado e informe diario implementan esos mismos límites en rangos inclusivos/exclusivos coherentes. Los días Excel no se usan como fuente del estado.

La implementación de estos rangos está duplicada entre `garantias/status.ts` y consultas de `repository.ts`/`dashboard/repository.ts`; requiere pruebas de tabla conjunta para evitar divergencias. El query de urgentes del dashboard incluye las vencidas, contrario al subtítulo actual. La configuración de rangos presentada en la UI no llega al backend y no cambia estas reglas.

### Autenticación y seguridad

- Contraseñas con `scrypt`, sal aleatoria y comparación de hash de longitud igual con `timingSafeEqual`; el usuario inactivo/sin hash ejecuta una verificación dummy.
- Token aleatorio de 32 bytes; solo hash SHA-256 en DB; cookie `HttpOnly`, `SameSite=Strict`, `Path=/api`, `Secure` si `NODE_ENV=production`; TTL de 8 horas. Logout borra la sesión en DB; cada endpoint protegido vuelve a consultar sesión/usuario, por lo que una sesión revocada, expirada o de usuario desactivado recibe 401.
- CORS restringido a `CORS_ORIGINS`; solicitudes no seguras exigen origen permitido. Revisar configuración de proxy y dominio/TLS en despliegue. El rate limit de login está en memoria por proceso, puede reiniciarse y no coordina múltiples réplicas.
- Todas las rutas de lectura de garantías y dashboard devuelven RUT y nombre del paciente a cualquier usuario autenticado. Definir acceso por rol/establecimiento y registrar auditoría de acceso antes de datos reales; actualmente no hay autorización de lectura más granular.
- No se muestran contraseñas ni hash en rutas del cliente revisadas. Aun así, revisar configuración de logs, backups, rotación de secretos y políticas de retención en el entorno desplegado.

### Importación Excel e integridad

La validación inspecciona solo la primera hoja y hasta 30 filas para encabezados; requiere todos los encabezados listados, incluido “días que faltan…”, aunque ese campo no alimenta el estado. La fila se valida con RUT y DV, fechas civiles ISO/serial/formatos habituales, orden inicio/límite y campos obligatorios. Se muestran hasta 10 filas válidas de vista previa. La etapa de validación es sin persistencia; al confirmar se crea el registro de importación con errores de validación y luego se procesa cada fila válida en transacción propia. Los fallos por fila se intentan registrar y el estado final es completada, con observaciones o fallida.

Dos cargas idénticas normalmente se resuelven como sin cambios si coinciden con la clave provisional. No se puede garantizar deduplicación correcta cuando cambia la fecha de inicio, problema o nombre, ni distinguir dos casos legítimos con atributos coincidentes; esos casos pueden duplicarse o acabar como ambiguos. Confirmar antes de adoptar un identificador estable y política para casos ambiguos. Validar también el tratamiento de filas en blanco: hoy se cuentan como error por fila; debe acordarse si son ruido al final del Excel o error reportable.

## E. Problemas prioritarios

| Prioridad | Hallazgo | Efecto |
| --- | --- | --- |
| **P1 — Integridad** | Clave provisional de importación; no existe identificador estable ni unicidad DB para una garantía de origen. | Duplicados o actualización incorrecta si cambian atributos usados como clave; una coincidencia múltiple se deja sin aplicar. |
| **P1 — Seguridad/datos** | Todo usuario autenticado puede leer nombre y RUT de todas las garantías; sin alcance por rol/unidad ni registro de consulta. | Exposición interna más amplia que el mínimo necesario para datos sensibles. Acordar mínimo privilegio y auditoría. |
| **P1 — Operación engañosa** | Feed/timbre, actividad y varias señales indican importaciones/correos/monitoreo ficticios; Dashboard dice monitoreo activo aunque el scheduler por defecto está apagado. | El usuario puede tomar decisiones operativas sobre información no real. |
| **P1 — Persistencia** | Acción “Gestionada” solo local; reglas de alerta/configuración/usuarios no persisten; no hay APIs de bandeja ni detalle de importación. | Estado se pierde y no existe auditoría completa de acciones/notificaciones. |
| **P1 — Auditoría de importación** | Importaciones no guardan actor; UI oculta errores detallados y muestra usuario `—`. | No se puede atribuir quién importó ni revisar/corregir filas desde el historial. |
| **P1 — Confiabilidad de correo** | Scheduler vive dentro del proceso API; requiere proceso supervisor/SMTP/config válidos. No ofrece historial UI ni garantía exactamente-una-vez ante caída tras aceptación SMTP. | Interrupciones o duplicados posibles; operación no verificable desde la aplicación. Está deshabilitado por defecto. |
| **P2 — Coherencia** | Urgentes incluye vencidas, pero el subtítulo promete solo no vencidas. Rangos se repiten en consultas y servicio. | Vista y reglas pueden divergir en bordes o cambios futuros. |
| **P2 — Datos Excel** | Campo de días restantes obsoleto sigue siendo obligatorio; primera hoja y encabezados limitados a 30 filas; vacías contadas como error. | Rechazo de planillas que podrían tener los datos esenciales; comportamiento de bordes debe acordarse/documentarse. |
| **P2 — Calidad/soporte** | Mojibake (`garantÃ­a`, `sesiÃ³n`, etc.) visible en UI, errores del backend, pruebas y documentación; `provision-user.ts` conserva al menos el mensaje “contrasena” sin tilde. | Lectura deficiente y riesgo de confusión; causa probable: archivo UTF-8 decodificado/guardado con charset incorrecto. |
| **P2 — Cobertura** | 76 pruebas pasan, pero no se identificó una suite E2E/DB/SMTP real. | No se acredita la operación de migraciones, persistencia, aislamiento, límites PostgreSQL ni entrega de correo. |
| **P3 — Toolchain** | El build de Vite emite avisos por `__dirname` y carga JSON con `configLoader: 'native'`. | Mantenimiento futuro de configuración; no bloquea la compilación actual. |

## F. Plan de trabajo por etapas

### Etapa 1 — Reducir el riesgo antes de datos reales

1. Definir roles de lectura, alcance organizacional y campos de paciente que cada perfil necesita; implementar autorización del servidor, no solo ocultar controles.
2. Acordar identificador estable de garantía en el origen Excel y política de cambios, ambigüedad y reimportación; agregar restricción/índice de acuerdo con esa identidad.
3. Asociar cada importación al `authUser.id`, proveer endpoint de detalle/errores y mostrar actor y errores paginados con minimización de datos sensibles.
4. Eliminar o rotular claramente feed, timbre, estadísticas y estado “monitoreo activo” ficticios; hacer que los estados de API caída no caigan a datos demo.

**Aceptación:** pruebas negativas y positivas por cada rol; reimportar dos veces la misma nómina produce conteos esperados sin duplicados; los casos ambiguos quedan trazables; ninguna señal de la UI afirma actividad que no tenga respaldo de API.

### Etapa 2 — Cerrar operaciones de negocio faltantes

1. Definir si gestión es un booleano o evento con comentario; persistir actor/fecha, historial y control de concurrencia.
2. Decidir si se implementan usuarios, reglas editables, estadísticas, bandeja e historial de notificaciones. Crear contratos API antes de conectar formularios.
3. Unificar cálculo/rangos de estado en un módulo compartido o probar todas las consultas contra una tabla de bordes; corregir urgentes y texto.
4. Acordar contrato Excel: encabezados, hoja, fechas, filas en blanco, días restantes opcionales, tamaño y suma de conteos.

**Aceptación:** recarga conserva acciones; API impone permisos; UI consulta esos endpoints y refleja estados vacíos/error/loading; pruebas de borde muestran las mismas categorías en lista, filtros, dashboard e informe.

### Etapa 3 — Endurecimiento operativo y correo

1. Definir despliegue supervisado para el backend/scheduler, health checks, logs/alertas y estrategia para una o varias réplicas.
2. Probar reserva/reintento y la ventana de fallo SMTP/DB; aceptar formalmente entrega al menos una vez o introducir reconciliación/proveedor idempotente donde exista.
3. Configurar SMTP solo en ambiente de prueba, validar TLS, remitente, destinatario, rotación, cambios de destinatario y retención del historial. Mantener apagado hasta aprobación operativa.
4. Medir rate limit de autenticación en el proxy real y adoptar almacenamiento compartido si el despliegue es multiinstancia.

**Aceptación:** pruebas de integración con PostgreSQL QA aislado y SMTP sandbox; reinicio/fallo recupera reserva sin estado silencioso; alertas operativas verificables; ninguna prueba incluye datos reales de pacientes.

### Etapa 4 — Calidad, encoding y liberación

1. Normalizar archivos a UTF-8 y verificar UI, API, mensajes, fixtures y documentación acentuada.
2. Añadir E2E del flujo login → importar → dashboard/listado → gestión → logout, y pruebas accesibles por teclado/errores.
3. Resolver avisos de Vite; ejecutar build/test y checklist de migraciones/backups en QA con revisión independiente antes de cualquier despliegue.

**Aceptación:** no hay mojibake en archivos de producto; builds/tests limpios; checklist de release documenta versiones, migraciones aplicadas, respaldo verificado y pruebas aprobadas.

## G. Límites de esta auditoría

La afirmación de que bootstrap, login, carga manual y cierre funcionan proviene del contexto entregado por el usuario; no la reproduje. La base configurada no se consultó y no se inspeccionó el contenido de ningún `.env`; solo se revisaron los archivos `.env.example`. No se validó la forma real de la nómina Excel, la topología de producción, privilegios PostgreSQL, entrega SMTP ni existencia/configuración de migraciones aplicadas. Estas cuestiones quedan **no verificadas**, no se consideran completadas.
