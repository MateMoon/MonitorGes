# Gestión de usuarios con tipos de garantías

Estado actualizado: la migración de usuarios ya está aplicada en QA por autorización posterior y expresa del usuario, sin respaldo previo. Ver [el registro de aplicación y comprobaciones](APLICACION_MIGRACION_USUARIOS_QA.md).

La continuación del 5 de noviembre implementa los [informes individuales por tipos asignados](INFORMES_INDIVIDUALES.md), con una migración adicional pendiente y el correo automático apagado. Las referencias a informes futuros en este documento describen la etapa inicial de Gestión de usuarios.

Implementación local del 4 de noviembre de 2026. Reutiliza Fastify, Prisma, PostgreSQL, la autenticación y los cuatro perfiles existentes. Durante la implementación inicial no se aplicaron migraciones ni se crearon, editaron o desactivaron cuentas en QA. No se ejecutaron importaciones, envíos de correo ni commits.

## Funcionalidades

La entrada de menú **Configuración** ahora se llama **Gestión de usuarios**, mantiene su identificador interno y sigue restringida a ADMIN. Presenta el resumen calculado por el backend (total, activos y preferencias de informes habilitadas), búsqueda por nombre/apellido/correo, filtros por perfil y estado, estados de carga/error/vacío y acciones de creación, edición, contraseña, desactivación y reactivación.

Crear y Editar abren ventanas centradas con `dialog.showModal()`, fondo oscurecido y desenfocado, desplazamiento en resoluciones pequeñas y bloqueo nativo de la interfaz exterior. El navegador contiene el foco y la navegación por teclado. Al cerrar se restaura el foco al botón de origen. Escape, Cancelar, X y pulsar el fondo solicitan confirmación si hay cambios. Seguir editando conserva el borrador; descartar no escribe datos. Durante el guardado se bloquean campos y cierre. Los errores de campo y del servidor permanecen visibles en el formulario. El multiselector admite búsqueda, teclado, selección múltiple, etiquetas extraíbles y contador; Escape cierra primero sus opciones.

No se modificaron los servicios ni las rutas de catálogos o áreas de responsabilidad. En el checkout inspeccionado Configuración solo contenía la administración de usuarios; no había una pantalla de áreas o catálogos dentro de ella que trasladar. Dashboard, garantías, seguimiento, importaciones e historial conservan sus componentes. Los cambios previos de esta sesión en los informes de correo y su descripción en Alertas se conservaron sin ampliarlos en esta etapa.

## Modelo y compatibilidad

`Usuario.nombre` **sigue representando el nombre completo visible** en autenticación, importaciones, áreas y gestiones. La migración añade:

| Campo | Tratamiento |
| --- | --- |
| `nombres String?` | Nombre o nombres explícitos; `NULL` para las cuentas anteriores. |
| `apellido String?` | Apellido explícito; `NULL` para las cuentas anteriores. |
| `recibirInformeAutomatico Boolean` | `false` por defecto. Solo preferencia futura. |
| `tiposGarantia UsuarioTipoGarantia[]` | Relación múltiple por nombre normalizado. |

La migración no reescribe ni divide los nombres anteriores. Editar los muestra completos en Nombre y deja Apellido por completar. Se puede conservar esta situación o registrar explícitamente los dos campos. Para las nuevas cuentas el apellido es obligatorio. Cuando se suministran los campos separados, el servicio reconstruye `nombre` como `nombres + " " + apellido`, con hasta 120 caracteres, para conservar los consumidores actuales.

Los PUT de clientes anteriores pueden seguir enviando `nombre` completo, correo, rol, estado y permiso sin los campos nuevos: las preferencias y asociaciones omitidas se conservan. Si un cliente anterior cambia el nombre completo, se conserva ese texto sin inferir sus partes y se vacían las partes anteriores para evitar datos contradictorios. Los campos separados se envían juntos (ambos textos o ambos nulos).

El POST conserva su ruta y campos existentes, pero exige además `apellido` para cumplir la nueva regla de altas. El frontend envía `nombre` completo y los campos explícitos `nombres` y `apellido`; si un cliente nuevo omite `nombres`, el servicio usa `nombre` como nombre de pila y lo combina con el apellido. Esta validación adicional debe incorporarse a cualquier consumidor externo del alta.

El login continúa usando **username y contraseña**. Username se introduce manualmente al crear, mantiene su unicidad y no es editable después. Se mantienen el correo único y sus reglas anteriores, contraseñas de 8–128 caracteres y hash scrypt. ADMIN conserva la carga de nóminas por perfil; LECTOR no puede obtener ese permiso. El restablecimiento de contraseña revoca sesiones.

## Tipos asignados y fuente de opciones

`GET /api/usuarios/tipos-garantia` obtiene la unión de:

1. Nombres del catálogo `TipoGarantia`, independientemente de sus combinaciones de áreas.
2. Valores distintos de `Garantia.nombreGarantia` presentes en las nóminas.
3. Nombres reales guardados previamente en `NombreGarantiaAsignable`, para conservar selecciones aunque después cambie su fuente.

Usa exactamente `normalizeIdentityText` del importador: elimina diferencias de tildes, mayúsculas, puntuación y espacios. No introduce alias, equivalencias semánticas ni coincidencias aproximadas. Conserva una etiqueta legible (primero la ya guardada, luego el catálogo, luego las nóminas) y ordena en español. Consultar opciones no escribe registros ni modifica el catálogo.

`NombreGarantiaAsignable` tiene `claveNormalizada` como clave primaria y `nombre` como etiqueta. Es un registro de identidades por nombre, independiente de los IDs y combinaciones de `TipoGarantia` del módulo de áreas. Solo se incorporan al guardar nombres comprobados contra las fuentes reales. `UsuarioTipoGarantia` relaciona `usuarioId` con `claveNormalizada`, con clave primaria compuesta y referencias restrictivas. Permite varios tipos por usuario y varios usuarios por tipo. La base y el servicio impiden vínculos duplicados. Quitar una selección elimina únicamente el vínculo de ese usuario; conserva el nombre, el catálogo y las selecciones ajenas.

El usuario, sus campos y el reemplazo de selecciones se guardan en una única transacción serializable. Las claves inexistentes se rechazan en el backend. Un fallo revierte también los datos personales y las selecciones anteriores. La comprobación del último ADMIN está en esa transacción, con hasta tres intentos ante conflictos de serialización, para evitar que bajas concurrentes retiren a todos los administradores.

Estas asociaciones no modifican `Garantia.responsable`, no reasignan pacientes, no definen un responsable exclusivo y no filtran el acceso al listado de garantías.

## API

Todas estas rutas comprueban ADMIN mediante la autorización real del backend:

| Ruta | Cambio |
| --- | --- |
| `GET /api/usuarios` | Reutilizada. Conserva `data: []` y añade `resumen: {total, activos, informesHabilitados}`. Cada usuario incluye las nuevas propiedades y `tiposGarantia: [{claveNormalizada, nombre}]`. |
| `POST /api/usuarios` | Reutilizada. Alta con apellido, estado, preferencia y claves de tipos; devuelve el usuario seguro sin hash ni contraseña. |
| `PUT /api/usuarios/:id` | Reutilizada. Edita datos y tipos de forma atómica. Las propiedades nuevas omitidas no se borran. |
| `PUT /api/usuarios/:id/contrasena` | Reutilizada. Restablece contraseña y revoca sesiones dentro de una transacción. |
| `GET /api/usuarios/tipos-garantia` | Nueva. Opciones por nombre, sin combinaciones. |
| `GET /api/usuarios/:id` | Nueva. Consulta el usuario y las selecciones persistidas. |

No se añadió DELETE. La desactivación exige confirmación en la interfaz y usa el PUT existente. Marca `activo=false` y revoca sesiones atómicamente, conservando importaciones, eventos, áreas, nombres y tipos para reactivar. No permite desactivar ni degradar al último ADMIN activo. El restablecimiento de contraseña también usa su ruta anterior.

## Preferencia de informes

Se guarda exclusivamente en `Usuario.recibirInformeAutomatico`, inicialmente deshabilitada, sin otra dirección de correo. La interfaz explica que los envíos individuales aún no están habilitados, que usarán el correo de la cuenta y que requerirán una cuenta activa. La tarjeta cuenta preferencias guardadas, incluso si la cuenta está inactiva; no representa entregas ni destinatarios operativos.

Esta etapa no conecta la preferencia con SMTP, scheduler, HTML, reservas ni lista global de Alertas. No crea un segundo mecanismo de envío. Para la próxima etapa quedan la selección de usuarios activos habilitados, el filtrado de garantías según sus tipos y una transición explícita desde la lista global que evite duplicados.

## Migración y verificación de QA

Nueva migración: `backend/prisma/migrations/20261104120000_user_guarantee_type_assignments/migration.sql`. Solo añade tres columnas y las dos tablas nuevas. No sustituye ni modifica migraciones anteriores.

Antes de implementar se ejecutó `node scripts/verify-qa-management.ts --inspect` con una transacción **READ ONLY**. La migración anterior `20261103120000_guarantee_management_timeline` ya estaba aplicada, con checksum coincidente y sus estructuras presentes. No había migraciones pendientes. Al terminar la implementación inicial, la misma consulta confirmó que solo quedaba pendiente la nueva migración de usuarios. Esa migración se aplicó posteriormente, según el registro de aplicación enlazado al comienzo; actualmente no quedan migraciones pendientes en QA.

Procedimiento de referencia para la aplicación (la ejecución posterior autorizada en QA se documenta en el registro enlazado al comienzo):

1. Respaldar QA y detener la API durante el despliegue. Revisar que la conexión efectiva identifica la base correcta y que no hay cambios de esquema parciales.
2. En PowerShell, dentro de `backend`, establecer `$env:AUTO_EMAIL_ENABLED = 'false'`. Mantenerlo deshabilitado durante la validación.
3. Ejecutar `node scripts/verify-qa-management.ts --inspect` y comprobar que solo figura la migración nueva como pendiente y los checksums anteriores coinciden.
4. Después de aprobar la aplicación, ejecutar `npm.cmd run prisma:deploy`. No usar `db push`, `migrate reset` ni `seed`.
5. Con la API detenida, ejecutar `npm.cmd run prisma:generate`, `npm.cmd run typecheck` y `npm.cmd run build`. Esto también evita bloqueos del DLL de Prisma en Windows.
6. Repetir la inspección de solo lectura y confirmar que no quedan migraciones pendientes. Reconstruir el frontend (`npm.cmd run typecheck` y `npm.cmd run build` en la raíz) y arrancar la API con la automatización deshabilitada para comprobar lectura y login.
7. Realizar pruebas de escritura solo en un entorno de pruebas preparado para ello. No usar cuentas reales de QA como datos de prueba.

## Verificaciones

- Pruebas iniciales: 176 correctas y dos fallos anteriores en `frontend-navigation.test.ts`, por esperar textos obsoletos de Alertas (`type="email" required` y avisos que ya no se mostraban). Se actualizaron esas expectativas a la validación de lista y al aviso actuales; no se cambió el funcionamiento de Alertas.
- Suite final: **208 pruebas correctas en 29 archivos**. Incluye 19 de rutas y autorización real, 9 de servicios de usuarios y 11 de interacciones React. También ejecuta las suites existentes de autenticación, importaciones, seguimiento, áreas, correo y proyecciones.
- Typecheck y build de frontend y backend, validación del esquema y generación del cliente Prisma.
- Integración PostgreSQL real en un clúster temporal propio (`ges_users_isolated`), sin cargar `.env` ni conectarse a QA: migración sobre nombres antiguos, persistencia de nombres separados, hashes, unicidad, relaciones compartidas y sin duplicados, consultas posteriores, retirada independiente de selecciones, rollback después de una falla de inserción inducida, preferencias, cambio de correo, historial, sesiones, reactivación, resumen y protección concurrente del último ADMIN. Las funciones de SMTP no se importan ni ejecutan.
- Las pruebas de UI usan jsdom y dobles de los servicios exclusivamente en tests. Comprueban apertura/cierre, foco inicial y restauración, confirmación de borrador, Escape, búsqueda y selección por teclado, recuperación de tipos, validaciones, errores del servidor, contraseña y confirmación de desactivación. jsdom no emula la capa modal nativa ni la presentación visual; queda pendiente el recorrido visual en navegador real después de preparar una base de prueba.

Para repetir las verificaciones:

```powershell
# En la raíz
npm.cmd run typecheck
npm.cmd run build

# En backend
npm.cmd run prisma:generate
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run test:users:postgres
```

El último comando requiere los binarios de PostgreSQL 18 en `C:\Program Files\PostgreSQL\18\bin`, crea un clúster nuevo en una ruta temporal y un puerto local aleatorio, ejecuta las comprobaciones y lo detiene. Conserva sus archivos para diagnóstico; nunca elimina directorios ni usa QA. Puede indicarse otra carpeta con `-PostgresBin` al script PowerShell. El bypass de política de ejecución solo se aplica al proceso de pruebas, sin modificar la configuración del equipo.

## Prueba manual de la sección

Con una base aislada preparada, migración aplicada y una cuenta ADMIN de prueba:

1. Entrar con username y contraseña. Abrir Gestión de usuarios y comprobar resumen, búsqueda, filtros y estados vacíos.
2. Abrir Nuevo usuario: introducir nombre, apellido, correo, username y contraseña válida. Verificar que la preferencia de informes comienza deshabilitada. Seleccionar varios tipos buscando texto; usar flechas/Enter, quitar una etiqueta y guardar.
3. Recargar y volver a Editar: comprobar nombres, permiso, estado, preferencia y tipos persistidos. Asignar uno de los mismos tipos a otro usuario. Retirarlo del primero y comprobar que sigue en el segundo.
4. Editar una cuenta antigua: comprobar que su nombre aparece completo y no se ha dividido. Completar los campos explícitamente y verificar que el nombre completo sigue legible en login e historial.
5. Modificar un campo y pulsar Cancelar, X o Escape. Seguir editando debe conservar el borrador; descartar debe conservar el valor guardado. Comprobar Tab/Mayús+Tab, foco inicial, retorno al botón de origen y presentación en una resolución pequeña.
6. Probar correo duplicado, username duplicado y contraseña corta. El modal debe conservar el formulario y mostrar el error.
7. Desactivar un usuario de prueba: pedir confirmación, cerrar sus sesiones, conservar antecedentes y tipos. Reactivar y comprobar persistencia. Intentar desactivar/degradar al último ADMIN debe fallar.
8. Restablecer una contraseña y comprobar que se revocan sus sesiones. Entrar con un perfil distinto de ADMIN y comprobar que no puede acceder ni llamar las operaciones administrativas.
9. Guardar la preferencia de informes y comprobar que solo se muestra la confirmación de configuración futura. No debe enviarse ningún correo.

## Archivos de esta implementación

- Backend: `backend/prisma/schema.prisma`, la nueva migración, `backend/src/modules/usuarios/{routes,repository,schema}.ts` y `backend/package.json`.
- Interfaz: `src/App.tsx`, `src/pages/GestionUsuarios.tsx`, el adaptador `src/pages/ConfiguracionUsuarios.tsx`, `src/components/{UserModal,UserEditor,GuaranteeTypeCombobox}.tsx`, `src/services/{usuarios,api}.ts`.
- Pruebas: `backend/test/{user-routes,user-repository,user-management-ui,frontend-navigation}.test.ts`, `backend/scripts/check-users-postgres.{ts,ps1}`.
- Herramientas/documentación: `package.json`, `package-lock.json`, `pnpm-lock.yaml` y este documento. Testing Library y jsdom son dependencias de desarrollo, sin datos simulados en la aplicación.
