# Perfiles de acceso

Hay cuatro perfiles persistidos: ADMIN, COORDINADOR_SOME (visible como Coordinador),
PROFESIONAL (Profesional gestor) y LECTOR. No se cambian identificadores ni se
requieren migraciones para estos permisos.

| Capacidad | Administrador | Coordinador | Profesional gestor | Lector |
|---|---|---|---|---|
| Dashboard, listado, detalle y filtros | Global | Global | Global | Según reglas |
| Registrar actuaciones | Sí | Sí | Sí | No |
| Cambiar estado, acreditar cumplimiento y reabrir | Sí | Sí | Sí | No |
| Supervisión: Resumen, Responsabilidades, Gestiones y cambios | Sí | Sí | No | No |
| Validar, comparar e importar Excel | Sí | Sí | Sí | No |
| Áreas y catálogos operativos | Sí | Sí | Sí | No |
| Vista previa/resultados de informes y configurar correo | Sí | Sí | Sí | No |
| Gestión de usuarios | Sí | No | No | No |
| Informe por correo | Según reglas | Sin filtro por reglas; vencidas o hasta 30 días | Según reglas | Según reglas |

Profesional gestor tiene las mismas capacidades operativas que Coordinador,
excepto Supervisión SOME. Gestión de usuarios sigue siendo exclusiva de ADMIN:
menú, navegación y todos los endpoints /api/usuarios, incluyendo lectura, creación,
edición, roles, contraseñas, correo y activación de cuentas.

El acceso global se centraliza en auth/permissions.ts y src/permissions.ts.
OPERATIONAL_ROLES incluye ADMIN, COORDINADOR_SOME y PROFESIONAL. SUPERVISION_ROLES
incluye solo ADMIN y COORDINADOR_SOME; el repositorio de Responsabilidades también
revalida esa autorización bajo transacción. El permiso heredado puedeCargarNominas
no reduce ni amplía el permiso de carga otorgado por el perfil.

Responsabilidades permite a ADMIN y Coordinador editar solo reglas de cuentas
no ADMIN, incluidas cuentas coordinadoras e inactivas. Las cuentas ADMIN se
configuran en Gestión de usuarios. Se conservan validación, guardado explícito,
control de revisión y el modelo único Usuario.reglasAsignacion.

## Informes por correo

Coordinador activo con correo válido recibe el informe completo de todas las
garantías no cumplidas en atención (16–30 días), próxima (8–15), crítica (0–7)
o vencida (menos de 0), sin aplicar sus reglas ni exigir recibirInformeAutomatico.
El plazo normal (más de 30 días) queda excluido para todos los perfiles. La interfaz muestra esta recepción
como incluida y no permite desmarcarla. Las reglas del coordinador sí identifican
su cobertura en Supervisión SOME; no restringen su vista ni su informe.

ADMIN, PROFESIONAL y LECTOR conservan los informes individuales según sus reglas:
cuenta activa, correo válido, recepción habilitada y garantías no cumplidas,
vencidas o con fecha límite dentro de los próximos 30 días. Tener acceso global en
pantalla no amplía el contenido de su correo. Sin reglas efectivas no hay informe.

El programador conserva su activación y horario configurados. Se reutiliza el
mismo envío individual con destinatario único, reservas y deduplicación. La huella
incluye el alcance completo del coordinador y se revalida bajo bloqueo antes de
leer pacientes y enviar; un cambio de rol entre alcance completo y filtrado
invalida la reserva. Las pruebas automáticas usan datos y SMTP simulados.

Los envíos manuales solicitados por el usuario utilizan el mismo servicio y
registro de resultados; ACEPTADO_SMTP confirma aceptación por el
transporte, no la entrega final al buzón.
