import { StringDecoder } from "node:string_decoder";
import type { ReadStream, WriteStream } from "node:tty";

type Input = Pick<ReadStream, "isTTY" | "setRawMode" | "resume" | "pause" | "on" | "off">;
type Output = Pick<WriteStream, "write">;

export function askHidden(input: Input, output: Output, label: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("Ejecuta este comando en una terminal interactiva para ocultar la contraseña."));
  }

  output.write(label);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const decoder = new StringDecoder("utf8");
    let settled = false;

    const cleanup = () => {
      input.off("data", onData);
      input.off("error", onError);
      input.off("end", onEnd);
      input.setRawMode(false);
      input.pause();
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onError = (error: Error) => finish(error);
    const onEnd = () => finish(new Error("La entrada de la terminal se cerró."));
    const onData = (chunk: Buffer | string) => {
      for (const character of decoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk)) {
        if (character === "\x03") return finish(new Error("Operación cancelada."));
        if (character === "\r" || character === "\n") {
          output.write("\n");
          return finish();
        }
        if (character === "\b" || character === "\x7f") value = Array.from(value).slice(0, -1).join("");
        else if (character >= " ") value += character;
      }
    };

    input.on("data", onData);
    input.on("error", onError);
    input.on("end", onEnd);
  });
}

export function validatePasswordConfirmation(password: string, confirmation: string) {
  if (Array.from(password).length < 14 || password !== confirmation) {
    throw new Error("La contraseña debe tener al menos 14 caracteres y coincidir con la confirmación.");
  }
}
