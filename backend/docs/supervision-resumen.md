# Supervisión SOME — contrato del Resumen

`GET /api/supervision/resumen` requiere una sesión válida y rol `ADMIN` o
`COORDINADOR_SOME` (Coordinador). Sin sesión válida responde 401; Profesional y
Lector reciben 403.
La respuesta autorizada usa `Cache-Control: no-store`.

El módulo incluye Resumen y Gestiones y cambios para ADMIN y Coordinador y la configuración
compartida de [Responsabilidades](supervision-responsabilidades.md), también
disponible para ambos con el mismo alcance. Este endpoint de Resumen
es de solo lectura. No modifica Prisma,
migraciones, dashboard, importaciones, reglas, permisos ni envíos de correo.
El contrato de actividad se documenta en [supervision-eventos.md](supervision-eventos.md).

## Respuesta 200

Ejemplo de estructura para una base sin garantías. Las fechas son marcadores del
formato; en ejecución se calculan para cada petición, nunca se usan datos de respaldo.

```json
{
  "data": {
    "fechaReferencia": "YYYY-MM-DD",
    "zonaHoraria": "America/Santiago",
    "generadoAt": "timestamp ISO 8601 UTC",
    "alcance": "GLOBAL",
    "indicadores": {
      "totalGarantias": 0,
      "pendientesResolucion": 0,
      "enGestion": 0,
      "cumplidas": 0,
      "vencidasNoCumplidas": 0,
      "proximas15DiasNoCumplidas": 0
    },
    "cobertura": {
      "sinProfesional": 0,
      "unProfesional": 0,
      "variosProfesionales": 0,
      "sinProfesionalNoCumplidas": 0
    },
    "criteriosCobertura": {
      "rol": "TODOS",
      "soloActivos": true,
      "profesionalesActivos": 0,
      "profesionalesConReglasEfectivas": 0
    },
    "distribuciones": {
      "soloNoCumplidas": true,
      "permiteSuperposicionEntreProfesionales": true,
      "porProblemaSalud": [],
      "porEstablecimiento": [],
      "porProfesional": []
    },
    "prioritarios": []
  }
}
```

`generadoAt` es el instante de inicio del cálculo. La fecha civil de Santiago se
obtiene una sola vez y se utiliza durante toda la petición.

### Indicadores

- `totalGarantias`: todas las garantías almacenadas, una vez por registro.
- `pendientesResolucion`: estado de gestión `PENDIENTE_RESOLUCION` únicamente.
- `enGestion`: estado de gestión `EN_GESTION`.
- `cumplidas`: estado de gestión `CUMPLIDA`.
- `vencidasNoCumplidas`: no cumplidas con días restantes negativos.
- `proximas15DiasNoCumplidas`: no cumplidas en estado de vencimiento crítica o
  próxima, de 0 a 15 días incluidos. No incluye vencidas.

Los estados de vencimiento y los días restantes se calculan con los helpers
existentes. Los indicadores de gestión y vencimiento se superponen; no deben sumarse
para obtener el total.

Las seis tarjetas abren el listado real de Garantías con el filtro correspondiente:
total con todos los plazos y estados de gestión; pendientes de resolución, en gestión
y cumplidas con su estado de gestión y todos los plazos; vencidas no cumplidas con
plazo vencido y `soloPendientes`; próximas a vencer con plazos crítica/próxima y
`soloPendientes`. Se reutilizan la navegación y `managementPreset` del dashboard.

### Cobertura

Participan todos los usuarios activos con reglas efectivas no vacías, sin filtrar
por perfil: ADMIN, Coordinador, Profesional y Lector. No se exige recepción de
correo ni permiso de importación. El acceso global de ADMIN o Coordinador no
proporciona cobertura automática: también deben tener reglas coincidentes.

`criteriosCobertura.rol` es `TODOS`. Para conservar compatibilidad se mantienen
los nombres históricos `profesionalesActivos`, `profesionalesConReglasEfectivas`,
`porProfesional`, `cantidadProfesionalesCoincidentes`, `profesionalesCoincidentes`,
los campos de `cobertura` y el motivo `SIN_PROFESIONAL_ACTIVO`. Todos se refieren
ahora a funcionarios/usuarios de cualquier perfil, no solo al rol PROFESIONAL.

Se reutilizan `userAssignmentRules()`, `matchesAssignmentRules()` y
`assignmentScopeForRules()`, conservando criterios abiertos, normalización y tipos
heredados cuando el JSON es `null`. Un JSON `[]` no recupera asignaciones anteriores.

Los primeros tres conteos de cobertura incluyen cumplidas y forman una partición
del total. `sinProfesionalNoCumplidas` es el conteo para el aviso operativo.

La cobertura del matcher se contrasta con el filtro SQL compartido. Las reglas
corruptas, errores de consulta o diferencias de resultados producen 503 y ninguna
cifra parcial. Esta validación no altera el comportamiento de los helpers de acceso.

### Distribuciones

Todas excluyen `CUMPLIDA`:

| Array | Campos de cada elemento |
|---|---|
| `porProblemaSalud` | `problemaSalud: string`, `cantidad: number` |
| `porEstablecimiento` | `establecimiento: string`, `cantidad: number` |
| `porProfesional` | `usuarioId: string`, `nombre: string`, `cantidad: number` |

El establecimiento se obtiene de `Garantia.responsable`. Problemas y establecimientos
se agrupan por el texto almacenado; las variantes ortográficas pueden aparecer como
barras distintas, aunque las reglas las reconozcan como equivalentes.

Cada funcionario cuenta una garantía una sola vez aunque tenga varias reglas
coincidentes. Distintos funcionarios pueden contar la misma garantía. El frontend
muestra «Garantías coincidentes por funcionario», no asignaciones exclusivas ni
una distribución porcentual sumable. Se incluyen usuarios con reglas efectivas
y cero coincidencias. Orden: cantidad descendente, nombre e identificador.

### Prioritarios

Hasta diez garantías no cumplidas, con este orden:

1. Vencidas.
2. Críticas: 0–7 días incluidos.
3. Sin funcionario coincidente y con más de siete días restantes.

Dentro de cada grupo se ordena por fecha límite ascendente (equivalente a días
restantes) y luego por identificador ascendente. Los grupos son excluyentes: una
vencida sin cobertura aparece una vez, con los dos motivos.

| Campo | Tipo / significado |
|---|---|
| `id` | UUID de la garantía; permite abrir el detalle existente |
| `paciente.nombre` | Nombre necesario para identificar el caso; no se devuelve RUT |
| `problemaSalud`, `nombreGarantia`, `establecimiento` | Texto almacenado |
| `fechaLimite` | Fecha civil `YYYY-MM-DD` |
| `estadoGestion` | `SIN_GESTION`, `EN_GESTION` o `PENDIENTE_RESOLUCION` |
| `estadoVencimiento` | `vencida`, `critica`, `proxima`, `atencion` o `normal` |
| `diasRestantes` | Entero, negativo cuando está vencida |
| `cantidadProfesionalesCoincidentes` | Número de funcionarios distintos, sin filtrar por perfil |
| `profesionalesCoincidentes` | Array de `{ usuarioId, nombre }` de usuarios activos cuyas reglas coinciden; orden por nombre e ID, sin repetir una cuenta por varias reglas |
| `motivosPrioridad` | Array de `VENCIDA`, `CRITICA`, `SIN_PROFESIONAL_ACTIVO` |
| `prioridad` | Grupo 1, 2 o 3 |

## Fallos y consistencia

Un error devuelve 503 con `error.code = SUPERVISION_UNAVAILABLE`, mensaje genérico,
`details: []` y `requestId`. No devuelve `data`. Los logs no registran excepciones
con parámetros SQL, reglas, usuarios ni pacientes.

Las lecturas se realizan en una transacción `RepeatableRead`, marcada `READ ONLY`,
con timeout de 30 segundos. Se agregan metadatos de garantías en PostgreSQL y solo
se leen nombres de pacientes para los casos prioritarios seleccionados. No se guarda
una caché de cobertura entre solicitudes.

Limitaciones de esta versión: lectura de reglas por profesional, trabajo
proporcional a las categorías y reglas existentes, agregación global por fecha y
categoría, y dos conteos SQL de comprobación. La comprobación visual utiliza lecturas
de QA con identidades anonimizadas; no es una prueba de rendimiento. No se agregan
índices ni se modifica el esquema. Las pruebas usan Prisma y
autenticación simulados con datos sintéticos, ejercitando las rutas y helpers reales;
complementan la comprobación de solo lectura sobre PostgreSQL QA.

## Verificación

Desde `backend`: `npm run build` y `npm test`. La suite contiene pruebas del módulo
en `test/supervision-summary.test.ts` y regresiones existentes de acceso e informes.
Estos comandos no necesitan ejecutar migraciones ni enviar correos reales.

## Interfaz y comprobación visual

`src/pages/SupervisionSome.tsx` consume el servicio `src/services/supervision.ts`.
El acceso al Resumen se restringe a ADMIN y Coordinador, además del guard del backend.
La pantalla muestra los seis indicadores, el aviso de cobertura, las tres
distribuciones y la tabla de casos prioritarios con acceso al detalle existente.
La columna «Funcionarios a cargo» muestra todos los nombres de
`profesionalesCoincidentes`, o «Sin funcionario asociado» para un array vacío.
Son coincidencias por reglas de cobertura; no implican asignación individual.
Trata carga, vacío, 401, 403 y errores de servicio de forma separada, sin reemplazar
errores por ceros. La tabla envuelve textos largos y mantiene el desplazamiento
horizontal dentro de su contenedor, también en móvil.

Desde `backend`, `node scripts/check-supervision-visual.mjs --activity` abre Chrome
sin ventana y captura ambas pestañas a 1440 y 390 píxeles. Requiere los builds del
backend, el frontend local en 8443 y una conexión a `monitor_garantias_qa` local.
Consulta los repositorios de solo lectura y sustituye nombres, comentarios y
respaldos antes de pasarlos al navegador. La autenticación visual se simula solo
dentro de ese navegador aislado, sin crear sesiones ni escribir en PostgreSQL.
El script bloquea las demás llamadas a API y conexiones externas. Las capturas
se guardan en una carpeta temporal y el informe no expone información personal.

«Ver todos los prioritarios» requerirá un filtro/listado compartido en una etapa
posterior; este endpoint no cambia el listado actual.
