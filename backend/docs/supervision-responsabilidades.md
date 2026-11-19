# Supervisión SOME — Responsabilidades

Esta pestaña edita exclusivamente `Usuario.reglasAsignacion`. Es la misma
configuración de Gestión de usuarios, utilizada por los filtros de dashboard,
listado, detalle, actuaciones e informes individuales. No agrega otro modelo ni
asigna garantías individuales. No cambia la semántica de criterios abiertos,
normalización, unión de reglas, combinaciones ni tipos heredados.

## Comparación con MonitorGES2

La referencia es `MonitorGES2/src/pages4.tsx`, pestaña `responsables`: tarjetas,
distribución de dos columnas, lista de criterios y panel lateral explicativo.
Sus `Card`, `CardHeader`, `Btn` y estilos Tailwind son compatibles con los que ya
existen en el proyecto actual. Se adapta esa estructura visual y navegación.

El prototipo guarda reglas en memoria y decide responsables principales mediante
activador, especificidad y asignación manual. Esa lógica, sus funcionarios de
apoyo, datos de ejemplo y matriz de perfiles no se utilizan aquí. Tampoco se copia
su afirmación de que las reglas solo afectan a garantías nuevas.

Se reutilizan del proyecto actual `UserAssignmentRules`, `AssignmentMultiSelect`,
`UserModal`, los helpers de `assignment-groups`, `assignmentRulesSchema`,
`listAssignmentOptions`, `saveAssignmentRules` y la transacción serializable de
usuarios. La validación de grupos se comparte también con `UserEditor`. El modal
mantiene el guardado explícito en la cabecera y confirma el descarte del borrador;
la cabecera puede envolver sus controles en pantallas estrechas.

## Autorización

| Operación | ADMIN | COORDINADOR_SOME | PROFESIONAL / LECTOR |
|---|---|---|---|
| Responsabilidades | Cuentas que no sean ADMIN | Solo PROFESIONAL y LECTOR activos | Denegada |
| Cambiar reglas desde esta pestaña | Solo cuentas que no sean ADMIN | Solo funcionarios del alcance anterior | Denegado |
| Resumen y Gestiones y cambios globales | Sí | Denegados | Denegados |
| Gestión de usuarios, roles, correo, actividad y contraseñas | Sí | Denegada | Denegada |

El alcance del coordinador fue confirmado para todos los PROFESIONAL y LECTOR
activos. Se excluyen ADMIN, otros coordinadores y su propia cuenta, incluso al
enviar manualmente el identificador de destino. Los roles y la actividad del autor
y destinatario se verifican nuevamente dentro de la transacción. No hay una nueva
relación de delegación por coordinador ni acceso global a garantías. Las reglas de
la cuenta coordinadora siguen limitando su propio acceso a los datos.

Las cuentas ADMIN tampoco se muestran ni pueden modificarse desde esta pestaña
cuando el autor es ADMIN. Su configuración se conserva exclusivamente en Gestión
de usuarios. La restricción se aplica al listado, a la interfaz y a la escritura
del backend, incluyendo cambios de perfil del destinatario entre lectura y guardado.

La API heredada `/api/areas-responsabilidad` queda exclusiva de ADMIN: su modelo
de áreas no es el utilizado por las reglas actuales y no debe constituir una vía
alternativa para que un coordinador modifique cuentas excluidas. No se migran,
eliminan ni reinterpretan las áreas existentes.

## Endpoints

`GET /api/supervision/responsabilidades` devuelve:

```typescript
{
  data: {
    funcionarios: Array<{
      id: string;
      nombre: string;
      rol: RolUsuario;
      activo: boolean;
      reglasAsignacion: AssignmentRule[];
      revision: string;
    }>;
    opciones: {
      problemasSalud: Array<{ claveNormalizada: string; nombre: string }>;
      establecimientos: Array<{ claveNormalizada: string; nombre: string }>;
      tiposGarantia: Array<{ claveNormalizada: string; nombre: string }>;
    };
  };
}
```

No expone correos, usernames, contraseñas, sesiones ni pacientes. La lectura usa
una transacción marcada `READ ONLY`. Los catálogos son los mismos que usa Gestión
de usuarios, incluyendo nombres importados, sin conteos globales ni datos de casos.
Un conjunto vacío de funcionarios se presenta explícitamente, sin datos ficticios.

`PUT /api/supervision/responsabilidades/:usuarioId` acepta exclusivamente:

```typescript
{ reglasAsignacion: AssignmentRule[]; revision: string }
```

`revision` es una huella SHA-256 de las reglas persistidas, tipos heredados cuando
corresponda, perfil y actividad del destinatario. El ID debe ser UUID. Campos
adicionales de administración son rechazados. Se validan como máximo 1000 reglas,
criterios disponibles y normalizados; se conservan selecciones previamente
guardadas aunque ya no aparezcan en el catálogo. Se deduplican las reglas.

Un array vacío elimina las reglas actuales y no recupera tipos heredados. La
respuesta devuelve `data` con el funcionario y la nueva revisión. Solo se escribe
`reglasAsignacion`, mediante el helper compartido, en una transacción
`Serializable` con los reintentos existentes.

Las respuestas de estos endpoints usan `Cache-Control: no-store`:

- 401: sesión inválida.
- 403: perfil o destinatario fuera del alcance.
- 400: cuerpo, identificación o criterios inválidos.
- 409 `STALE_ASSIGNMENT_RULES`: la configuración cambió desde la lectura. No se
  sobrescribe el cambio; el editor conserva la selección y solicita recargar.
- 409 `INVALID_STORED_ASSIGNMENT_RULES`: reglas corruptas que requieren revisión.
- 503 `RESPONSIBILITIES_UNAVAILABLE`: fallo sin datos parciales ni parámetros SQL.

El control de revisión protege los guardados de esta pestaña frente a cambios
previos desde cualquiera de los dos paneles. Gestión de usuarios conserva su
contrato existente y no incorpora aquí un control de revisión propio.

## Autoría y límites de auditoría

Después de confirmar una transacción que cambió las reglas, esta API registra
`ASSIGNMENT_RULES_CHANGED` en el logger del servidor con origen, fecha, ID y perfil
del autor, ID del funcionario, revisión anterior/nueva y número de reglas. No
registra nombres, reglas completas, datos de pacientes ni credenciales. Los
guardados sin cambios y las operaciones rechazadas no inventan eventos de cambio.

Estos registros comienzan con esta función y dependen de la conservación de logs.
No constituyen una auditoría histórica transaccional en PostgreSQL: un cierre entre
el commit y el log puede impedir registrar el evento. Los cambios hechos desde
Gestión de usuarios conservan su trazabilidad previa, sin un nuevo historial de
autoría en esta etapa. No se muestran ni reconstruyen registros históricos.

Una auditoría consultable y completa de ambos paneles requeriría justificar una
tabla específica con autor, destino, antes/después y fecha, escrita en la misma
transacción por el helper compartido; después habría que preparar su migración y
política de acceso y conservación. No se reutiliza `EventoGarantia` porque no es
un evento de una garantía ni `AreaResponsabilidad`, que sería un segundo modelo.

No se modifica Prisma ni se ejecutan migraciones, escrituras de QA o correos para
validar esta entrega. Las escrituras se prueban con Prisma simulado y fixtures
sintéticas. La comprobación de navegador puede leer QA de forma estrictamente de
solo lectura y anonimiza nombres antes de presentarlos.

## Verificación

- Frontend: `npm run typecheck` y `npm run build`.
- Backend: `npm run build` y `npm test`.
- Pruebas específicas: `supervision-responsibilities.test.ts`,
  `supervision-ui.test.ts`, `responsibilities-frontend-service.test.ts` y
  regresiones de usuarios, áreas, alcance de garantías e informes.
- Navegador: desde backend, con servidor Vite en 8443 y build del backend,
  `node scripts/check-supervision-visual.mjs --responsibilities --activity`.
  `--coordinator` verifica la presentación restringida y que no se soliciten
  Resumen ni actividad global. Si QA no contiene una cuenta coordinadora, solo
  para esta comprobación visual se filtra una instantánea real leída por ADMIN;
  se informa `coordinatorAuthorizationSimulated: true`. Los permisos reales se
  ejercitan con los guards y repositorios de la aplicación en las pruebas.

El script bloquea cualquier petición de escritura desde el navegador, no crea
sesiones y guarda capturas temporales a 1440 y 390 píxeles. Las capturas no
constituyen una prueba de persistencia real en QA.

## Archivos de esta incorporación

- Backend nuevo: `src/modules/supervision/responsibility-repository.ts` y
  `responsibility-routes.ts`; registro en `src/modules/supervision/routes.ts`.
- Reutilización y permisos: `src/modules/usuarios/schema.ts`,
  `src/modules/usuarios/repository.ts` y `src/modules/areas-responsabilidad/routes.ts`.
- Frontend nuevo: `src/pages/SupervisionResponsibilities.tsx` y
  `src/services/responsabilidades.ts`.
- Integración y componentes compartidos, desde la raíz del proyecto:
  `src/App.tsx`, `src/pages/SupervisionSome.tsx`, `src/components/UserEditor.tsx`,
  `src/components/UserModal.tsx` y `src/services/assignment-groups.ts`.
- Pruebas: `test/supervision-responsibilities.test.ts`,
  `test/responsibilities-frontend-service.test.ts`, `test/supervision-ui.test.ts`
  y `test/responsibility-area-routes.test.ts`.
- Verificación visual: `scripts/check-supervision-visual.mjs`.
- Documentación: este archivo, `supervision-resumen.md` y `supervision-eventos.md`.

Los paths de backend de esta lista se interpretan desde `backend/`, salvo los
indicados explícitamente desde la raíz del proyecto.
