# Diseño propuesto: backend y contrato REST

Documento de diseño para la siguiente etapa del Monitor de Garantías GES. Describe una futura API Node.js + TypeScript + Fastify + PostgreSQL; no crea ni presupone una base de datos, autenticación, trabajador en segundo plano, correo ni importador implementado. Los ejemplos son contratos propuestos, no respuestas del frontend actual.

## 1. Lo que usa hoy el frontend

El modelo real de la demo está en `src/types/index.ts`; los datos ficticios están en `src/data/mockData.ts`. Las pantallas aún leen esos mocks directamente, salvo garantías, que pasan por el adaptador `src/services/garantias.ts`. `src/services/api.ts` solo proporciona una función fetch genérica y una URL base; no hay llamadas HTTP activas.

| Pantalla | Datos que necesita | Fuente demo actual |
| --- | --- | --- |
| Login | usuario ingresado y resultado de acceso; en producción, identidad y rol de sesión | Validación local simulada en `pages1.tsx`; sin entidad de sesión ni endpoint |
| Dashboard | conteos por estado, ocho garantías próximas no vencidas, última importación y actividad reciente | `CONTEOS`, `GARANTIAS_DATA` y actividad escrita directamente en la pantalla |
| Garantías | paciente/RUT, problema, nombre, fechas, días, estado, responsable; filtros y página | `GARANTIAS_DATA`, `PROBLEMAS`, `RESPONSABLES`; filtro y paginación local |
| Detalle | garantía y paciente, plazo/estado, responsable, gestión, hitos de notificación | `GARANTIAS_DATA`; hitos derivados artificialmente en la pantalla; gestión solo en estado local de `App` |
| Importación | archivo, muestra de filas, conteos de validación, errores por fila, resultado | Flujo y conteos simulados en `pages2.tsx`; filas de `GARANTIAS_DATA` |
| Historial de importaciones | fecha, usuario, archivo, conteos, estado y errores | Tuplas `IMPORTS` |
| Alertas | bandeja con fecha, garantía, paciente, tipo, destinatario, canal, estado; reglas, frecuencia y monitoreo | `NOTIFS`; reglas y métricas de monitoreo locales/estáticas |
| Estadísticas | conteos por estado, responsable, próximos vencimientos, evolución mensual | `CONTEOS`, `RESPONSABLES`, `NEXT30`, `EVO`, `MESES` (parte derivada o escrita en la pantalla) |
| Configuración | rangos/colores, reglas de aviso, frecuencia, usuarios/roles/activo/último acceso | reglas de estado locales, controles de alertas locales y tupla `USUARIOS` |

La demo usa `Date` y nombres cortos (`problema`, `garantia`, `inicio`, `limite`, `dias`); la API debe adoptar nombres explícitos y fechas ISO (`problemaSalud`, `nombreGarantia`, `fechaInicio`, `fechaLimite`). `TODAY` en `src/data.ts` es una fecha fija de demostración: el contrato de producción nunca la toma como reloj de negocio. “Gestionada” tampoco es persistente hoy; si la acción debe sobrevivir a sesiones, hace falta registrarla en backend.

## 2. Entidades y relaciones

IDs UUID opacos en API y persistencia. Fechas civiles como `YYYY-MM-DD`; instantes como ISO 8601 UTC. RUT se almacena normalizado (número sin separadores y DV normalizado) y se formatea al presentar.

| Entidad | Campos propuestos | Relación / observación |
| --- | --- | --- |
| `Paciente` | `id`, `rutNumero`, `dv`, `nombre`, `createdAt`, `updatedAt` | Un paciente puede tener muchas garantías. Restricción única sobre `(rutNumero, dv)`. El nombre puede actualizarse con una importación válida. |
| `Garantia` | `id`, `pacienteId`, `problemaSalud`, `nombreGarantia`, `fechaInicio`, `fechaLimite`, `responsable`, `createdAt`, `updatedAt`, `gestionadaAt?`, `gestionadaPorUsuarioId?`, `version` | Pertenece a un paciente. `diasRestantes` y `estado` son derivados de fecha límite, fecha actual del servidor y configuración activa, no columnas fuente. `responsable` podría normalizarse si existe catálogo oficial; el frontend actual no muestra identificador de responsable. |
| `Importacion` | `id`, `nombreArchivo`, `fechaImportacion`, `usuarioId?`, `estado`, `registrosLeidos`, `registrosNuevos`, `registrosActualizados`, `registrosSinCambios`, `registrosConError` | Una importación tiene errores por fila; conservar resumen y detalle auditable. El archivo no requiere guardarse permanentemente después del procesamiento. |
| `ErrorImportacion` | `id`, `importacionId`, `numeroFila`, `codigo`, `mensaje`, `datosFila?` | Muchos errores por importación. `datosFila` debe limitarse y excluir datos personales innecesarios. |
| `Notificacion` | `id`, `garantiaId?`, `tipo`, `canal`, `destinatario`, `fechaProgramada`, `fechaEnvio?`, `estado`, `error?`, `claveIdempotencia?` | Una garantía puede tener muchas notificaciones; una notificación puede ser un resumen y no corresponder a una sola garantía, de ahí `garantiaId` opcional. Mantener eventos/historial, no sobrescribir envíos anteriores. |
| `Usuario` | `id`, `nombre`, `username`, `email`, `rol`, `activo`, `ultimoAccesoAt?`, `createdAt`, `updatedAt` | Puede ser responsable de importación o gestión. Credenciales y sesiones no se exponen en esta entidad ni en `GET /usuarios`; se diseñarán junto a autenticación en otra etapa. |
| `ConfiguracionEstado` | `id/clave`, `nombre`, `diasMin?`, `diasMax?`, `color`, `activo`, `orden` | Una fila por estado. Límites inclusivos; `null` significa sin límite. Evitar rangos solapados o huecos dentro de los estados activos. |
| `ReglaAlerta` | `id`, `diasRespectoVencimiento`, `tipo`, `canal`, `activo`, `destinatarioRegla?` | `diasRespectoVencimiento` positivo = antes del vencimiento, cero = el día, negativo = después. Incluye resumen diario como regla de tipo distinta si se conserva. |
| `ConfiguracionMonitoreo` | `id`, `frecuencia`, `horariosLocales`, `zonaHoraria`, `activo` | Solo configuración. Ejecución programada efectiva queda fuera de esta etapa. |

Relaciones centrales: `Paciente 1—N Garantia`; `Usuario 1—N Importacion`; `Importacion 1—N ErrorImportacion`; `Garantia 1—N Notificacion`; `Usuario 1—N` garantías gestionadas. Las reglas de estados y alertas son configuración global; no se duplican dentro de cada garantía.

**Rangos iniciales compatibles con la demo:** vencida `(-∞,-1]`, crítica `[0,7]`, próxima `[8,15]`, atención `[16,30]`, normal `[31,+∞)`. Que estos rangos sean editables requiere validar consistencia al guardar toda la configuración como una unidad.

## 3. Identificación de garantías durante importación

RUT identifica a la persona, nunca a una garantía. Tampoco basta el par RUT + nombre de garantía: puede repetirse en distintos episodios. La fecha de inicio y el problema ayudan, pero el Excel descrito no especifica si vienen siempre, con qué precisión, ni si se corrigen posteriormente; responsable es mutable y no identifica un episodio.

**Recomendación:** pedir al propietario de la nómina un identificador estable y único de garantía/caso, emitido por el sistema fuente, y guardar una clave de origen junto con el sistema/organización de origen. Hacerla única (por origen) y usarla para decidir coincidencia. RUT sigue siendo referencia al paciente. Con esa clave: coincidencia = actualizar campos permitidos; clave nueva = insertar otra garantía, incluso para el mismo RUT.

Hasta confirmar que tal clave existe, no fusionar automáticamente casos ambiguos. Puede normalizarse y comparar `(RUT, nombreGarantia, problemaSalud, fechaInicio)` como candidato, pero:

- si todas las dimensiones requeridas son iguales, presentar como coincidencia candidata para revisión, no como identidad demostrada;
- si falta fecha de inicio o problema, hay más de un candidato, hay valores contradictorios o la fila pretende modificar esos identificadores, marcarla como ambigua y no actualizar;
- responsable y fecha límite son atributos actualizables y no deben formar la clave;
- una coincidencia parcial no debe crear duplicados silenciosamente: debe ir a revisión según una política acordada.

Esto evita tanto pisar otra garantía del mismo paciente como generar duplicados por una corrección de nombre. Requiere decidir si el proceso permite revisión manual, rechazo de importación completa o importación parcial de filas no ambiguas. El contrato de abajo propone importación parcial con errores/ambigüedades informados y transacción por fila válida.

**Implementación provisional de la etapa 5.2:** como la nómina disponible no aporta un identificador estable confirmado, el backend coincide por RUT/DV normalizados + problema de salud + nombre de garantía + fecha de inicio. Una coincidencia única permite modificar fecha límite y responsable; varias coincidencias se registran como ambiguas y no se actualizan. Esta política es solo para datos ficticios y debe confirmarse con la estructura oficial antes de usar datos reales.

## 4. Convenciones REST

Prefijo `/api`, JSON UTF-8, respuestas de listas con `data` y `pagination`. `limit` predeterminado 25, máximo 100; `page` comienza en 1. Orden permitido mediante `sort` y `order=asc|desc`; rechazar campos de orden desconocidos. Fechas de filtro inclusivas. El formato de error común es `{ "error": { "code": "...", "message": "...", "details": [] }, "requestId": "..." }`.

| Método y ruta | Propósito, parámetros y cuerpo | Respuesta y errores principales |
| --- | --- | --- |
| `GET /api/garantias` | Listar. Query: `rut`, `nombre`, `estado` (repetible o CSV), `responsable`, `problemaSalud`, `nombreGarantia`, `fechaLimiteDesde`, `fechaLimiteHasta`, `page`, `limit`, `sort`, `order`. | `200 {data: GarantiaResumen[], pagination}`; `400 VALIDATION_ERROR`. Solo devuelve valores calculados por servidor. |
| `GET /api/garantias/:id` | Obtener detalle por UUID. | `200 {data: GarantiaDetalle}`; `404 NOT_FOUND`. Incluye paciente, eventos de notificación paginados o recientes y datos de gestión. |
| `GET /api/dashboard` | Resumen agregado para tarjetas, lista urgente y actividad reciente. Query opcional `urgentesLimit` acotado. | `200 {data: {conteosPorEstado, total, ultimaImportacion, garantiasUrgentes, actividadReciente}}`; `400`. Conteos y lista se calculan en una misma referencia temporal. |
| `POST /api/importaciones` | `multipart/form-data`, campo `archivo` `.xlsx`, máximo propuesto 10 MB. Usuario se toma de la sesión futura, no de un `usuarioId` confiado del body. Validar extensión, MIME real, tamaño, estructura y filas. | `201 {data: ImportacionResultado}` tras procesamiento síncrono; cada fila válida se aplica transaccionalmente. Errores de archivo completo: `400 VALIDATION_ERROR` / `UNSUPPORTED_FILE`; `413 FILE_TOO_LARGE`; `409 IMPORT_CONFLICT` si una importación concurrente entra en conflicto. Fallo inesperado `500`. |
| `GET /api/importaciones` | Historial con `page`, `limit`, `estado`, `desde`, `hasta`, `sort`, `order`. | `200 {data: Importacion[], pagination}`; `400`. |
| `GET /api/importaciones/:id` | Resumen y detalle paginado de errores; query `erroresPage`, `erroresLimit`. | `200 {data: ImportacionDetalle}`; `404`; `400`. |
| `GET /api/notificaciones` | Bandeja. Query `estado`, `canal`, `tipo`, `garantiaId`, `desde`, `hasta`, `page`, `limit`, `sort`, `order`. | `200 {data: Notificacion[], pagination}`; `400`. No dispara envíos. |
| `GET /api/alertas` | Reglas y estado informativo de monitoreo (activo, revisión anterior/próxima si se configura). | `200 {data: {reglas, monitoreo}}`; `503 SERVICE_UNAVAILABLE` si no se puede obtener estado operativo. No implementa scheduler. |
| `GET /api/configuracion` | Leer rangos de estado, reglas de alerta y frecuencia/zona horaria. | `200 {data: Configuracion}`. |
| `PUT /api/configuracion` | Reemplazar configuración editable completa; body con `estados`, `reglasAlerta`, `monitoreo`. Validar rangos, códigos, horarios y zona horaria antes de guardar. | `200 {data: Configuracion}`; `400 VALIDATION_ERROR`; `409 CONFIGURATION_CONFLICT` si se adopta control optimista (`version`). |
| `GET /api/usuarios` | Listar usuarios no sensibles con `page`, `limit`, `activo`, `rol`, `sort`, `order`. | `200 {data: Usuario[], pagination}`; `400`. No devuelve credenciales. |

Operaciones que la demo ya sugiere pero la lista inicial de endpoints no cubre: `POST /api/usuarios` para el modal “Agregar usuario”; `PATCH /api/garantias/:id/gestion` para persistir marcar/desmarcar gestionada. Recomendadas antes de conectar esas interacciones. La gestión puede aceptar `{ "gestionada": true }`; el actor y la fecha los asigna el servidor. No definir un endpoint de login hasta acordar autenticación institucional y sesión.

## 5. Ejemplos JSON

**Garantía en lista** (la API entrega el RUT normalizado y los campos de presentación explícitos):

```json
{
  "data": [{
    "id": "4c6e6d0e-6d5d-4f21-9a4b-cc7e0dd23c4d",
    "paciente": { "id": "f99e4fda-ea74-46df-a733-a31044a5db86", "rut": "12345678-9", "nombre": "Juan Pérez" },
    "problemaSalud": "Tamizaje",
    "nombreGarantia": "Tamizaje PAP",
    "fechaInicio": "2026-01-10",
    "fechaLimite": "2026-10-13",
    "diasRestantes": 5,
    "estado": "critica",
    "responsable": "Centro de Salud Rural"
  }],
  "pagination": { "page": 1, "limit": 25, "total": 1, "totalPages": 1 }
}
```

**Filtro/paginación:** `GET /api/garantias?rut=12345678-9&estado=critica&responsable=Centro%20de%20Salud&page=1&limit=25&sort=fechaLimite&order=asc`.

**Subida:** `POST /api/importaciones` como multipart con `archivo=<xlsx>`. No enviar un JSON que contenga el archivo base64.

**Resultado con dos errores de fila, luego de aplicar las filas válidas:**

```json
{
  "data": {
    "id": "b4a58de3-64b2-4b88-9a89-96eeae5848ae",
    "nombreArchivo": "Nomina_06102026.xlsx",
    "fechaImportacion": "2026-10-06T11:32:00Z",
    "estado": "completada_con_observaciones",
    "registrosLeidos": 253,
    "registrosNuevos": 8,
    "registrosActualizados": 32,
    "registrosSinCambios": 211,
    "registrosConError": 2,
    "errores": [
      { "numeroFila": 118, "codigo": "INVALID_DATE", "mensaje": "Fecha límite con formato inválido." },
      { "numeroFila": 204, "codigo": "INVALID_RUT_DV", "mensaje": "Dígito verificador inválido." }
    ]
  }
}
```

La suma de las cuatro categorías de resultado debe ser igual a `registrosLeidos` según la definición cerrada de fila procesable. Es necesario acordar si filas de encabezado se excluyen de `registrosLeidos`; la recomendación es contar solo filas de datos. Errores detallados pueden paginarse con el endpoint de detalle. Si ninguna fila puede procesarse, definir `fallida` con cero altas/cambios y conservar errores.

## 6. Cálculo de días y estado

Fuente de verdad: `fechaLimite`. Calcular `diasRestantes` como diferencia entre la fecha límite y la fecha civil actual en una zona horaria institucional configurada, sin componente horario; vencida ayer da `-1`, vence hoy da `0`. Usar reloj del servidor, nunca el día enviado por cliente ni el `TODAY` fijo de demo. La zona horaria debe decidirse (probablemente `America/Santiago`) para que la transición de día y los trabajos diarios sean coherentes. `estado` se obtiene de los rangos activos validados en configuración. Al cambiar el día, una garantía puede cambiar de estado sin que se actualice su fila.

## 7. Flujo conceptual de Excel

1. Recibir archivo y validar tamaño/extensión/formato y columnas requeridas; fallar el archivo completo si no se puede interpretar.
2. Leer filas de datos, normalizar RUT, DV, espacios, fechas y textos; no usar la columna de “días faltantes”.
3. Validar cada fila y acumular errores con número de fila/código/mensaje.
4. Resolver paciente por RUT normalizado. Resolver garantía por clave estable de origen; sin esa clave, aplicar la política conservadora de candidatos ambiguos descrita arriba.
5. Comparar campos persistentes: insertar, actualizar solo diferencias permitidas, o marcar sin cambios. Registrar cada fila conflictiva sin aplicarla.
6. Confirmar filas válidas en transacciones; guardar importación, conteos y errores para auditoría. Evitar que reintentar la misma carga cree duplicados cuando hay clave de origen.
7. Responder con el resultado final y recalcular estado/días en lecturas posteriores. No enviar correos como parte de esta etapa.

## 8. Estructura de backend sugerida

```text
backend/
  src/
    app.ts                 # creación/configuración de Fastify
    server.ts              # arranque y cierre
    plugins/               # conexión DB, autenticación futura, logger
    routes/                # registro de rutas y prefijos
    modules/
      garantias/            # routes, schema, controller, service, repository
      pacientes/
      importaciones/        # parser/validación conceptual aislada del HTTP
      notificaciones/
      configuracion/
      usuarios/
      dashboard/
    db/                     # cliente y transacciones (cuando se implemente)
    schemas/                # esquemas compartidos de Fastify/JSON Schema
    utils/                  # fechas, normalización RUT, errores
    types/
  test/                     # se definirá al iniciar implementación
```

Responsabilidades: rutas validan contrato y conectan controller; controller traduce HTTP; service contiene reglas de negocio/transacción; repository concentra acceso a datos; schemas validan entrada/salida; utilidades son funciones puras. Mantener parser Excel separado para poder cambiar formato sin introducir lógica de dominio en la ruta.

## 9. Mapeo de servicios frontend a API futura

| Adaptador/consumidor futuro | Endpoint |
| --- | --- |
| `getGarantias()` | `GET /api/garantias` (aceptará filtros/paginación; no traer todo para filtrar en navegador) |
| `getGarantiaById(id)` | `GET /api/garantias/:id` |
| `getDashboard()` (nuevo) | `GET /api/dashboard` |
| `importarGarantias(file)` (nuevo) | `POST /api/importaciones` multipart |
| `getImportaciones()` / `getImportacion(id)` (nuevos) | `GET /api/importaciones` / `GET /api/importaciones/:id` |
| `getNotificaciones()` (nuevo) | `GET /api/notificaciones` |
| `getConfiguracion()` / `saveConfiguracion(config)` (nuevos) | `GET /api/configuracion` / `PUT /api/configuracion` |
| `getUsuarios()` (nuevo) | `GET /api/usuarios` |
| `createUsuario()` (si se conserva el modal) | `POST /api/usuarios` (propuesto adicional) |
| `setGestionada(id, value)` (si la acción debe persistir) | `PATCH /api/garantias/:id/gestion` (propuesto adicional) |
| Login | Fuera del contrato actual; requiere acordar SSO/proveedor y mecanismo de sesión |

Mantener `src/services/api.ts` como transporte común, pero los adaptadores de dominio deben convertir fechas ISO a la representación elegida por componentes o, preferiblemente, actualizar los tipos para operar con fechas de forma consistente cuando comience la integración. No reemplazar los mocks durante esta etapa.

## 10. Decisiones pendientes y riesgos

1. **Clave estable de garantía:** confirmar si el Excel tiene ID único de caso/garantía y su estabilidad histórica. Sin él, la identidad no puede deducirse con certeza de RUT y atributos mutables.
2. **Ambigüedad/importación parcial:** aprobar la política de revisión manual y si filas válidas se aplican aunque haya errores en otras filas.
3. **Columnas reales y formato:** obtener plantilla/archivo de ejemplo, confirmar si fecha de inicio, problema, responsable y fecha límite son obligatorios y cómo aparecen fechas y múltiples hojas.
4. **Responsable:** decidir si es texto libre, establecimiento/catálogo, usuario asignado o destinatario de alertas; la demo actual solo ofrece un nombre de establecimiento.
5. **Estados y hora de corte:** confirmar rangos editables, zona horaria institucional y semántica exacta de “vence hoy”.
6. **Notificaciones:** definir destinatarios, canal, reglas, política de reintentos/idempotencia y si se guardan resúmenes; envío efectivo queda fuera de esta fase.
7. **Persistencia de gestión:** decidir si “marcar como gestionada” representa solo una etiqueta o un evento con comentario/resolución e historial.
8. **Usuarios y acceso:** acordar SSO/autenticación, permisos por rol y quién puede importar, configurar o administrar usuarios antes de exponer operaciones sensibles.
9. **Datos personales:** definir retención de archivos/errores, logging sin RUT innecesario, control de acceso y auditoría antes de procesar datos reales.
10. **Métricas:** acordar períodos para evolución mensual y definición de conteos; la serie de demo es estática y no constituye especificación de negocio.

## Fuera de alcance de esta etapa

No se implementan PostgreSQL, migraciones, ORM, Docker, autenticación, worker, SMTP, envío de correos ni lectura real de Excel. El frontend y sus mocks quedan intactos.
