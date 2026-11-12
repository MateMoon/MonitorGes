# Aplicación de la migración de usuarios en QA

Operación del 4 de noviembre de 2026, autorizada expresamente por el usuario **sin respaldo previo**.

La migración `20261104120000_user_guarantee_type_assignments` quedó **aplicada** en `monitor_garantias_qa`. Las nueve migraciones del proyecto están aplicadas, sus checksums coinciden y la comparación de la base con el esquema Prisma no presenta diferencias.

## Comprobaciones y ejecución

- Se comprobó que la conexión efectiva coincide con `backend/.env` y apunta exactamente a `monitor_garantias_qa`, esquema `public`. No se mostraron credenciales.
- Antes de desplegar, la única migración pendiente era la autorizada. No había migraciones fallidas ni estructuras nuevas parciales. El diff del esquema solo contenía sus cambios previstos.
- El SQL coincide con el archivo previamente probado en PostgreSQL aislado. SHA-256: `6de4b405af18d08e0c3fbdaa9b9d409b29ed6d03684db1238fead5996aafd454`. Solo añade columnas, tablas, claves y un índice; no modifica ni elimina registros existentes.
- Se identificaron y detuvieron únicamente el backend del proyecto y su vigilancia de cambios. Vite permaneció ejecutándose.
- Se guardó `AUTO_EMAIL_ENABLED=false` en `backend/.env` y se utilizó ese mismo valor para los comandos y el servidor reiniciado.
- Se ejecutó `npm.cmd run prisma:deploy` desde `backend`, con resultado correcto.
- Se completaron `npm.cmd run prisma:generate`, `npm.cmd run typecheck` y `npm.cmd run build`. La primera generación encontró el DLL ocupado por el proceso de verificación; al terminar ese proceso se repitió correctamente y después se repitieron typecheck y build.
- `prisma migrate status` confirma que el esquema está actualizado. `prisma migrate diff` contra el esquema declarado devuelve una migración vacía.

## Estructuras y conservación de datos

Están presentes `Usuario.nombres` y `Usuario.apellido`, ambos texto nullable, y `Usuario.recibirInformeAutomatico`, booleano no nullable con valor predeterminado `false`. Las tablas `NombreGarantiaAsignable` y `UsuarioTipoGarantia` tienen las claves primarias y referencias previstas. Ambas están vacías; los usuarios anteriores conservan las nuevas partes del nombre en `NULL` y la preferencia deshabilitada.

Se compararon conteos y huellas agregadas de las 15 tablas anteriores mediante transacciones READ ONLY antes y después del despliegue. Coincidieron íntegramente. No se guardaron copias de registros: la comparación se mantuvo en memoria y no constituye un respaldo.

| Datos | Antes | Después |
| --- | ---: | ---: |
| Usuarios | 3 | 3 |
| Garantías | 217 | 217 |
| Pacientes | 212 | 212 |
| Importaciones | 11 | 11 |
| Eventos de garantía | 10 | 10 |
| Registros de informe de correo | 2 | 2 |

No se crearon, editaron ni eliminaron usuarios, no se ejecutaron importaciones ni se enviaron correos. No se ejecutaron reset, db push, seed, reconstrucción de QA ni commits.

## Disponibilidad y alcance de la prueba de API

El backend compilado quedó iniciado en `http://localhost:3001` con automatización deshabilitada, confirmada por su log de arranque. Vite responde HTTP 200 en `http://localhost:8443`.

Las lecturas reales de los servicios de usuarios y tipos funcionan sobre QA: devuelven tres usuarios activos y cuatro opciones de tipos, con el contrato esperado y sin exponer hashes de contraseña.

`GET /api/usuarios` y `GET /api/usuarios/tipos-garantia` responden HTTP 401 sin cookie, conservando la protección de acceso. No se dispuso del token de una sesión ADMIN para comprobar HTTP 200 autenticado. No se creó una sesión ni se simuló autorización para sustituir esa prueba.

**Gestión de usuarios está lista para probar en el navegador con una sesión ADMIN.** Abrir el frontend, iniciar sesión si hace falta y entrar en Gestión de usuarios. La prueba autenticada de ambos GET queda pendiente de esa sesión. La preferencia de informes continúa sin activar envíos individuales.

Si posteriormente se cierra el proceso local del backend, se puede iniciar de nuevo desde VS Code:

```powershell
cd 'C:\proyectos\Monitor de Garantías GES\backend'
$env:AUTO_EMAIL_ENABLED = 'false'
npm.cmd start
```
