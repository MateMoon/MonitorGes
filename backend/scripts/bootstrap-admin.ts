import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPassword } from "../src/modules/auth/auth-service.js";
import { prisma } from "../src/db/prisma.js";
import { askHidden, validatePasswordConfirmation } from "./hidden-password.js";

const prompt = createInterface({ input: stdin, output: stdout });
try {
  const username = (await prompt.question("Usuario institucional: ")).trim();
  const nombre = (await prompt.question("Nombre completo: ")).trim();
  const email = (await prompt.question("Correo institucional: ")).trim().toLowerCase();
  if (!username || !nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Usuario, nombre y correo válidos son obligatorios.");
  prompt.close();

  const password = await askHidden(stdin, stdout, "Contraseña nueva (mínimo 14 caracteres): ");
  const confirmation = await askHidden(stdin, stdout, "Repite la contraseña: ");
  validatePasswordConfirmation(password, confirmation);
  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    const credentialedAdmin = await tx.usuario.count({ where: { rol: "ADMIN", passwordHash: { not: null } } });
    if (credentialedAdmin > 0) throw new Error("Ya existe un administrador con credenciales. El bootstrap inicial no se puede volver a ejecutar.");
    const existingUser = await tx.usuario.findFirst({ where: { OR: [{ username }, { email }] } });
    if (existingUser && (existingUser.username !== username || existingUser.email !== email)) throw new Error("El usuario o correo ya pertenece a otra cuenta.");
    const passwordlessAdmin = await tx.usuario.findFirst({ where: { rol: "ADMIN" } });
    if (passwordlessAdmin && passwordlessAdmin.id !== existingUser?.id) throw new Error("Ya existe una cuenta ADMIN sin contraseña. Usa exactamente su usuario y correo para habilitarla.");
    if (existingUser) {
      await tx.usuario.update({ where: { id: existingUser.id }, data: { nombre, rol: "ADMIN", activo: true, passwordHash } });
    } else {
      await tx.usuario.create({ data: { username, nombre, email, rol: "ADMIN", activo: true, passwordHash } });
    }
  }, { isolationLevel: "Serializable" });
  console.info(`Administrador inicial creado o habilitado para ${username}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "No se pudo preparar el administrador.");
  process.exitCode = 1;
} finally {
  prompt.close();
  await prisma.$disconnect();
}
