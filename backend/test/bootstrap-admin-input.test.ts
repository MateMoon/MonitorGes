import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { describe, expect, it } from "vitest";
import { askHidden, validatePasswordConfirmation } from "../scripts/hidden-password.js";

function terminal() {
  const stream = new PassThrough() as PassThrough & EventEmitter & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  stream.isTTY = true;
  const modes: boolean[] = [];
  stream.setRawMode = (enabled) => modes.push(enabled);
  const writes: string[] = [];
  const output = { write: (value: string) => { writes.push(value); return true; } };
  return { stream, modes, writes, input: stream as unknown as ReadStream, output: output as unknown as WriteStream };
}

describe("bootstrap admin password input", () => {
  it("supports two hidden reads, backspace, and confirms without closing stdin", async () => {
    const { stream, modes, writes, input, output } = terminal();
    const first = askHidden(input, output, "Password: ");
    stream.write(Buffer.from("abcdefghijklmX\x7f\r"));
    await expect(first).resolves.toBe("abcdefghijklm");

    const second = askHidden(input, output, "Confirm: ");
    stream.write(Buffer.from("abcdefghijklm\r"));
    await expect(second).resolves.toBe("abcdefghijklm");
    expect(modes).toEqual([true, false, true, false]);
    expect(writes).toEqual(["Password: ", "\n", "Confirm: ", "\n"]);
  });

  it("restores normal mode after cancellation", async () => {
    const { stream, modes, input, output } = terminal();
    const result = askHidden(input, output, "Password: ");
    stream.write(Buffer.from("\x03"));
    await expect(result).rejects.toThrow("Operación cancelada.");
    expect(modes).toEqual([true, false]);
  });

  it("requires 14 characters and an exact confirmation", () => {
    expect(() => validatePasswordConfirmation("1234567890123", "1234567890123")).toThrow("al menos 14");
    expect(() => validatePasswordConfirmation("12345678901234", "12345678901235")).toThrow("coincidir");
    expect(() => validatePasswordConfirmation("12345678901234", "12345678901234")).not.toThrow();
  });
});
