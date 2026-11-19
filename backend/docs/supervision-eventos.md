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
      secuencia: number;
      tipo: "ACTUACION" | "CAMBIO_ESTADO" | "CUMPLIMIENTO" | "REAPERTURA" | "ANTECEDENTE_LEGADO";
      tipoActuacion: TipoActuacion | null;
      comentario: string | null;
      estadoAnterior: EstadoGestion | null;
      estadoNuevo: EstadoGestion | null;
      respaldo: string | null;
      createdAt: string; // Fecha persistida, ISO 8601 UTC
      autorNombre: string | null; // Nombre conservado al registrar el evento
      usuarioId: string | null;
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
eventos persistidos, ordenados por `createdAt DESC, secuencia DESC`, utilizando el
mismo orden y selección de campos del historial de garantía. No se agrupan eventos
por paciente ni garantía. No hay paginación o filtros en esta versión.

La consulta se ejecuta en una transacción `RepeatableRead` marcada `READ ONLY`,
con timeout de 30 segundos. No modifica el esquema ni crea eventos. El contexto de
paciente y garantía corresponde a los datos actuales; no representa una fotografía
histórica. El autor y los cambios de estado provienen del evento original, aunque
la cuenta haya cambiado de nombre o ya no exista. Los antecedentes legados pueden
tener autor y estados desconocidos; estos campos conservan `null`.

No se incluyen RUT, emails, credenciales, metadatos de importación ni datos de otras
relaciones de usuario. El nombre del paciente permite identificar el caso en la
interfaz restringida. Comentarios y respaldos solo se muestran a ADMIN.

## Interfaz

`src/pages/SupervisionActivity.tsx`, integrado como segunda pestaña de
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

El historial recupera los eventos de gestión que ya guarda el sistema. Las
importaciones no producen eventos detallados de cambios de campos; no se inventa
historial de importaciones, asignaciones individuales o cambios de responsables.
Los antecedentes antiguos se identifican explícitamente. No se implementa
Calidad de datos. Responsabilidades dispone de su configuración compartida en
[supervision-responsabilidades.md](supervision-responsabilidades.md). El coordinador
también puede consultar este historial global.

Las pruebas de `test/supervision-activity.test.ts`,
`test/supervision-frontend-service.test.ts` y `test/supervision-ui.test.ts` verifican
autorización, orden y límite, datos nulos e históricos, ausencia de campos privados,
fallos, carga diferida, cancelación, reintento, teclado y acceso al detalle. Usan
fixtures sintéticas y dobles de Prisma/autenticación. La comprobación visual usa
lecturas reales de QA anonimizadas según el procedimiento documentado en el
contrato del Resumen, sin escrituras ni correos.
