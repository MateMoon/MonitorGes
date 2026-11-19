# Inicio de sesión con usuario o correo

El formulario admite el nombre de usuario o correo registrado, con la misma
contraseña. El campo es de texto, conserva `autocomplete="username"` y acepta
hasta 254 caracteres. El botón de mostrar/ocultar contraseña sigue disponible.

`POST /api/auth/login` conserva el contrato `{ username, password }` para clientes
existentes; `username` ahora representa cualquiera de los dos identificadores.
Se eliminan espacios exteriores del identificador, pero no de la contraseña.

Los nombres de usuario conservan su comparación exacta. Las entradas con `@`
consultan correo sin distinguir mayúsculas y también el nombre de usuario exacto
para compatibilidad con cuentas previas. La consulta se limita a dos candidatos;
si resulta ambigua, el acceso se rechaza en lugar de elegir una cuenta.

Se conservan verificación scrypt, rechazo de cuentas inactivas o sin contraseña,
comparación simulada para identificadores inexistentes/ambiguos, cookies y duración
de sesión. El error de credenciales es genérico: «Datos de acceso incorrectos».
El límite de intentos sigue agrupando variaciones de mayúsculas del mismo correo.
No se registran identificadores ni contraseñas en los mensajes de autenticación.

No requiere migraciones ni cambios de cuentas existentes. La validación automatizada
usa datos sintéticos, Prisma simulado y sesiones simuladas; no modifica QA ni envía
correos. Pruebas: `auth-service.test.ts`, `auth-routes.test.ts` y `login-ui.test.ts`.
