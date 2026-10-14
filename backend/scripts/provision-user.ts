import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { StringDecoder } from "node:string_decoder";
import { hashPassword } from "../src/modules/auth/auth-service.js";
import { prisma } from "../src/db/prisma.js";

async function askHidden(label: string) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") throw new Error("Ejecuta este comando en una terminal interactiva de Windows para ocultar la contrasena.");
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  const decoder = new StringDecoder("utf8");
  try {
    for await (const chunk of stdin) for (const character of decoder.write(Buffer.from(chunk))) {
      if (character === "\x03") throw new Error("Operación cancelada.");
      if (character === "\r" || character === "\n") { stdout.write("\n"); return value; }
      if (character === "\b" || character === "\x7f") value = Array.from(value).slice(0, -1).join("");
      else if (character >= " ") value += character;
    }
    return value;
  } finally { stdin.setRawMode(false); stdin.pause(); }
}

const prompt = createInterface({ input: stdin, output: stdout });
try {
  const username = (await prompt.question("Usuario institucional: ")).trim();
  const nombre = (await prompt.question("Nombre completo: ")).trim();
  const email = (await prompt.question("Correo institucional: ")).trim().toLowerCase();
  const role = (await prompt.question("Rol (PROFESIONAL o LECTOR): ")).trim().toUpperCase();
  if (!username || !nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["PROFESIONAL", "LECTOR"].includes(role)) throw new Error("Datos inválidos. Este comando no crea administradores.");
  prompt.close();
  const password = await askHidden("Contraseña inicial (mínimo 14 caracteres): ");
  const confirmation = await askHidden("Repite la contraseña: ");
  if (password.length < 14 || password !== confirmation) throw new Error("La contraseña debe tener al menos 14 caracteres y coincidir con la confirmación.");
  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    if (await tx.usuario.count({ where: { rol: "ADMIN", activo: true } }) === 0) throw new Error("Primero debe existir un administrador activo.");
    const existing = await tx.usuario.findFirst({ where: { OR: [{ username }, { email }] } });
    if (existing && (existing.username !== username || existing.email !== email)) throw new Error("El usuario o correo ya pertenece a otra cuenta.");
    if (existing?.rol === "ADMIN") throw new Error("Este comando no puede modificar administradores.");
    if (existing) {
      await tx.usuario.update({ where: { id: existing.id }, data: { nombre, activo: true, rol: role as "PROFESIONAL" | "LECTOR", passwordHash } });
      await tx.sesionUsuario.deleteMany({ where: { usuarioId: existing.id } });
    } else {
      await tx.usuario.create({ data: { username, nombre, email, activo: true, rol: role as "PROFESIONAL" | "LECTOR", passwordHash } });
    }
  }, { isolationLevel: "Serializable" });
  console.info(`Cuenta ${role} creada o actualizada para ${username}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "No se pudo aprovisionar la cuenta.");
  process.exitCode = 1;
} finally { prompt.close(); await prisma.$disconnect(); }
