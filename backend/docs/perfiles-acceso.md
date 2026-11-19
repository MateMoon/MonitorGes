# Perfiles de acceso

El perfil visible «Coordinador SOME» se denomina ahora **Coordinador**. Conserva el
valor persistido `COORDINADOR_SOME` para mantener cuentas, sesiones y clientes sin
migraciones. No se cambia el rol de ninguna cuenta ni se escribe en QA.

Coordinador tiene los mismos permisos operativos que ADMIN. La excepción es la
Gestión de usuarios, cuyo menú, navegación y todos los endpoints `/api/usuarios`
continúan exclusivos de ADMIN: lectura de cuentas/opciones, creación, edición de
datos personales, perfil, estado y restablecimiento de contraseñas.

| Capacidad | Administrador | Coordinador | Profesional | Lector |
|---|---|---|---|---|
| Dashboard, listado, detalle y filtros | Global | Global | Según reglas | Según reglas |
| Registrar actuaciones | Sí | Sí | Según reglas | No |
| Cambiar estado, acreditar cumplimiento y reabrir | Sí | Sí | No | No |
| Supervisión: Resumen, Responsabilidades, Gestiones y cambios | Sí | Sí | No | No |
| Validar, comparar e importar Excel | Sí | Sí | Con permiso individual | No |
| Áreas y catálogos operativos | Sí | Sí | No | No |
| Vista previa/resultados de informes y configurar correo | Sí | Sí | No | No |
| Gestión de usuarios | Sí | No | No | No |

El endpoint existente de lectura de configuración de correo conserva su acceso
para sesiones autenticadas; la fila de configuración de la tabla se refiere a
los cambios y a la consulta operativa de informes.

Se centraliza el alcance global en `auth/permissions.ts` del backend y
`src/permissions.ts` del frontend. Los guards de las rutas y la autorización
interna del repositorio de gestiones admiten ambos perfiles. Las rutas de usuarios
conservan explícitamente `requireRoles("ADMIN")`.

Responsabilidades muestra y permite editar las mismas cuentas no ADMIN para ambos
perfiles, incluidas cuentas coordinadoras y cuentas inactivas. Solo se escriben
reglas, con validación y control de revisión. Las cuentas ADMIN siguen excluidas
de esta pestaña, incluso para ADMIN; se configuran en Gestión de usuarios. Modificar
reglas propias de Coordinador no modifica su perfil ni permisos de administración.

Las reglas personales de ADMIN y Coordinador delimitan sus informes individuales
por correo; ya no restringen su vista operativa global. Las reglas de Profesional y
Lector siguen delimitando sus datos. Los requisitos de cuenta activa, recepción de
correo y selección de garantías del informe se conservan. No se envían correos en
las pruebas ni se alteran las actuaciones o la historia de garantías.

Las páginas de Garantías y Seguimiento reutilizan sus controles administrativos
para ambos perfiles; el componente de Gestión de usuarios recibe el permiso
ADMIN real y nunca la capacidad operativa global.
