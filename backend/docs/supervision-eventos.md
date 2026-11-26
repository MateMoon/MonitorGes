# Supervisión SOME — Gestiones y cambios

`GET /api/supervision/eventos` requiere sesión válida y rol ADMIN o Coordinador
(`COORDINADOR_SOME`). Devuelve 401 sin sesión válida y 403 para PROFESIONAL y LECTOR. El permiso de cargar
nóminas no otorga acceso. Las respuestas de la consulta usan `Cache-Control: no-store`.

## Contrato

```typescript
{
  data: {
    generadoAt: string; // Inicio de consulta, ISO 8601 UTC
    zonaHoraria: "America/Santiago";
    alcance: "GLOBAL";
    limite: 30;
    eventos: Array<{
      id: string;
      secuencia: number | null; // null exclusivamente para revisiones de importación
      tipo: "ACTUACION" | "CAMBIO_ESTADO" | "CUMPLIMIENTO" | "REAPERTURA" | "ANTECEDENTE_LEGADO" | "REVISION_IMPORTACION";
      tipoActuacion: TipoActuacion | null;
      comentario: string | null;
      estadoAnterior: EstadoGestion | null;
      estadoNuevo: EstadoGestion | null;
      respaldo: string | null;
      createdAt: string; // Fecha persistida, ISO 8601 UTC
      autorNombre: string | null; // Nombre conservado al registrar el evento
      usuarioId: string | null;
      // Solo en REVISION_IMPORTACION. Su ID público es revision-importacion:<id>.
      revisionImportacion?: {
        id: string;
        decision: "MISMA" | "DISTINTA";
        descripcion: string;
        justificacion: string;
        garantiaResultadoId: string;
        origen: { importacionId: string; archivo: string | null; hoja: string | null; numeroFila: number | null };
      };
      garantia: {
        id: string;
        paciente: { nombre: string };
        problemaSalud: string;
        nombreGarantia: string;
        establecimiento: string; // Garantia.responsable
        estadoGestion: EstadoGestion;
      };
    }>;
  };
}
```

`TipoActuacion` y `EstadoGestion` son los enums existentes. Un historial vacío
devuelve `eventos: []`, sin ejemplos ni datos de respaldo. Se leen como máximo 30
eventos persistidos de ambas fuentes en una única ventana global. El orden es
`createdAt DESC`, fuente (gestión antes que revisión en empates), `secuencia DESC`
para gestiones e ID descendente como desempate estable. No se aplican treinta
registros por separado a cada tabla ni se agrupan eventos por paciente o garantía.
No hay paginación ni filtros en esta vista; se conserva el límite global existente.

La consulta se ejecuta en una transacción `RepeatableRead` marcada `READ ONLY`,
con timeout de 30 segundos. No modifica el esquema ni crea eventos. El contexto de
paciente y garantía corresponde a los datos actuales; no representa una fotografía
histórica. El autor y los cambios de estado provienen del evento original, aunque
la cuenta haya cambiado de nombre o ya no exista. Los antecedentes legados pueden
tener autor y estados desconocidos; estos campos conservan `null`.

No se incluyen RUT, emails, credenciales, huellas, evidencias JSON completas ni datos
de otras relaciones de usuario. El origen de las revisiones incluye únicamente
archivo, hoja, número de fila e ID de importación. El nombre del paciente permite
identificar el caso en la interfaz restringida. Comentarios, respaldos y
justificaciones solo se muestran a ADMIN y COORDINADOR_SOME.

## Interfaz

`src/pages/SupervisionActivity.tsx`, integrado como pestaña Gestiones y cambios de
`SupervisionSome.tsx`, consulta el historial al abrirse por primera vez. Alternar
pestañas conserva los paneles sin repetir consultas. «Actualizar historial» vuelve
a consultar; desmontar cancela peticiones pendientes. Las pestañas admiten flechas,
Inicio y Fin y mantienen etiquetas y paneles accesibles.

Cada evento presenta tipo, autor disponible, fecha con segundos en hora de Santiago,
tipo de actuación cuando existe, transición de estado y acceso al detalle mediante
el ID real de la garantía. Se muestran comentarios y motivo de reapertura; los
comentarios extensos y el respaldo de cumplimiento pueden desplegarse. La vista
mantiene textos largos dentro de sus tarjetas en escritorio y móvil.

Se distinguen carga, vacío, fallo recuperable, sesión inválida y acceso restringido.
Un fallo del repositorio devuelve 503 con código `SUPERVISION_ACTIVITY_UNAVAILABLE`,
mensaje genérico, `details: []` y `requestId`. No devuelve datos parciales ni registra
excepciones con parámetros SQL. El servicio frontend valida el contrato y rechaza
respuestas incompletas con `INVALID_SUPERVISION_ACTIVITY_RESPONSE`.

## Alcance y validación

El historial recupera los eventos de gestión y las resoluciones de importación
que ya guarda el sistema. La importación normal sigue sin producir eventos
detallados de cambios de campos; no se inventa historial de asignaciones
individuales o cambios de responsables.
Los antecedentes antiguos se identifican explícitamente. Responsabilidades dispone de su configuración compartida en
[supervision-responsabilidades.md](supervision-responsabilidades.md). El coordinador
también puede consultar este historial global.

## Antecedentes históricos del retiro de la versión anterior

Supervisión SOME conserva únicamente Resumen, Responsabilidades y Gestiones y
cambios. La implementación anterior de Calidad de datos fue retirada el
25 de noviembre de 2026, incluidos sus componentes, servicios y endpoints.
En ese retiro se conservaron los eventos normales de las garantías y su historial.
La integración nueva descrita a continuación añade lecturas de resoluciones del
módulo independiente; no recupera los componentes retirados.

El código previo se conserva en la referencia local de Git
`recovery/calidad-antes-retiro-20261125-623d80a3`, commit
`ff2cd7af80d4035ca8264add2c9a0cf8379da1b6`. La rama activa y los cambios
locales ajenos se conservaron. Los modelos Prisma CasoCalidad, EvidenciaCalidad
y EventoCalidad y la migración `20261124120000_quality_review_cases` permanecen
declarados para mantener coherencia con el historial aplicado. Sus tablas y datos
no se utilizan desde la aplicación y no se alteraron. Se conserva el respaldo
protegido de QA fuera del repositorio. El reemplazo nuevo utiliza otros modelos,
servicios y una sección independiente, sin recuperar esa implementación anterior.

Inventario del retiro:

- Frontend: `src/pages/SupervisionDataQuality.tsx`, `src/components/calidad/`
  (11 componentes) y los cuatro servicios `src/services/calidad-*.ts`.
- Backend: `backend/src/modules/supervision/calidad/` (14 archivos).
- Pruebas exclusivas: los 11 archivos `backend/test/quality-*.test.ts`.
- Herramientas exclusivas: `check-quality-postgres.ps1`,
  `check-quality-postgres.ts`, `check-quality-readonly.ts` y
  `check-quality-visual.mjs`, dentro de `backend/scripts/`.
- Documentación antigua: `backend/docs/calidad-analisis-excel.md` y
  `backend/docs/calidad-casos-revision.md`.
- Se retiraron también los dos scripts temporales exclusivos de despliegue y
  lectura y 27 artefactos compilados obsoletos. Los informes históricos de
  respaldo y los archivos SQL de migración se conservaron.

Los ajustes restantes se limitan a `src/pages/SupervisionSome.tsx`,
`backend/src/modules/supervision/routes.ts`, las pruebas `routes.test.ts` y
`supervision-ui.test.ts`, este documento y
`backend/scripts/check-management-postgres.ts`. Este último conserva la prueba
negativa de permisos usando una sesión LECTOR: PROFESIONAL ya tiene permisos
operativos en la aplicación. No se modificaron las autorizaciones reales.

Se conservaron el parser, clasificador, normalizadores, repositorios y servicios
compartidos del importador, `POST /api/importaciones/comparar`, los componentes
UI compartidos y `postgres-test-control.cjs`, que utiliza más de una herramienta
de verificación.

Verificación del retiro: 476 pruebas en 41 archivos; TypeScript y compilaciones
de frontend/backend; regresión real de gestiones en PostgreSQL aislado;
comprobación visual de las tres pestañas con lecturas anonimizadas; ocho rutas
retiradas con respuesta 404 tanto en pruebas como en el backend en ejecución.
Prisma valida el esquema y muestra 13 migraciones al día. No se ejecutaron
escrituras ni migraciones en QA.

Las pruebas de `test/supervision-activity.test.ts`,
`test/supervision-frontend-service.test.ts` y `test/supervision-ui.test.ts` verifican
autorización, orden y límite, datos nulos e históricos, ausencia de campos privados,
fallos, carga diferida, cancelación, reintento, teclado y acceso al detalle. Usan
fixtures sintéticas y dobles de Prisma/autenticación. La comprobación visual usa
lecturas reales de QA anonimizadas según el procedimiento documentado en el
contrato del Resumen, sin escrituras ni correos.

## Implementación actual — integración del nuevo módulo independiente

La etapa 6 añade lecturas de `ResolucionFilaImportacion` al endpoint existente
`GET /api/supervision/eventos`. No crea un segundo historial ni escribe eventos
de garantía. Resumen, Responsabilidades, sus indicadores y las reglas de asignación
se conservan. Calidad de datos continúa en su propia sección del menú.

El repositorio `activity-repository.ts` ejecuta una consulta de catálogo dentro
de la transacción de solo lectura para saber si existe la tabla de resoluciones.
Si todavía no existe, conserva la consulta anterior de eventos de garantía;
esto permite desplegar el código sin aplicar migraciones en QA. Si existe, lee
las dos fuentes mediante `UNION ALL`, ordena y aplica un único `LIMIT 30` sobre
sus identificadores. Después obtiene el contenido de esos IDs y reconstruye el
orden seleccionado por PostgreSQL. No hay límites independientes ni consultas
que amplíen el conjunto después de aplicar la ventana global.

La detección no depende de `IMPORT_RETENTION_ENABLED` ni `DATA_QUALITY_ENABLED`.
Una resolución ya guardada sigue siendo visible con los dos flujos apagados.
Una tabla migrada sin resoluciones produce la actividad normal o un vacío real.
Los errores de lectura no se convierten en ceros o cronologías parciales: el
endpoint mantiene su respuesta 503 sanitizada.

Los eventos normales conservan ID, secuencia y semántica. Las revisiones usan
`revision-importacion:<UUID de resolución>` para no colisionar con otra tabla,
`tipo: REVISION_IMPORTACION`, secuencia null y campos de actuación, comentario,
transición de estado y respaldo en null. Su justificación se encuentra en el
objeto propio `revisionImportacion`, no se presenta como un comentario de gestión.

MISMA muestra «Se confirmó que los datos recibidos corresponden a una garantía
existente» y apunta al ID de la garantía conservada. DISTINTA muestra «Se confirmó
una garantía distinta y se incorporó un nuevo registro» y apunta al ID creado.
Ambas conservan autor histórico, fecha, justificación y origen de la fila. La
interfaz reutiliza la lista y el acceso al detalle existentes; una insignia
distingue MISMA y DISTINTA. La justificación extensa puede desplegarse sin añadir
paneles o indicadores. El frontend valida el contrato combinado y sus vínculos.

Las revisiones no son actuaciones y no afectan `revisionGestion`, estado de
cumplimiento, indicadores o recuentos del historial propio de una garantía. No
se modifican el importador, su política, la resolución operativa, el modal,
los permisos generales ni los informes de correo. No hay migraciones nuevas.

Validación reproducible desde `backend`:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run test:supervision-review:postgres
```

La comprobación PostgreSQL crea un clúster temporal aislado con datos sintéticos,
verifica la lectura antes de aplicar las migraciones de las etapas anteriores,
y repite la prueba con la tabla migrada sin resoluciones. Ejecuta las regresiones
de retención y resolución y después consulta decisiones reales MISMA/DISTINTA con
ambas configuraciones apagadas. Comprueba usuario, origen, ID de destino, permisos
con sesiones reales, una ventana global de 30 entre 80 registros intercalados,
empates, IDs iguales entre tablas y ausencia de cambios mediante huellas de las
tablas antes y después de las lecturas. Detiene el clúster al terminar. No utiliza
QA ni producción y no inicia servidor HTTP o correos.

Para habilitar el flujo completo en QA sigue siendo necesario autorizar y aplicar
allí las tres migraciones pendientes (`20261125120000_import_row_persistence`,
`20261125150000_import_retention_progress`, `20261125170000_review_resolution_evidence`),
desplegar backend y frontend compatibles, verificar el recorrido completo con
cuentas autorizadas y habilitar explícitamente las dos configuraciones conforme
al procedimiento de despliegue aprobado. Esta etapa no hace ninguna de esas
activaciones ni modifica datos o configuraciones de QA.
