// @vitest-environment jsdom
import { createElement, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

const path = "../../src/pages/pages1.tsx";
const { Login } = await import(path) as { Login: ComponentType<{ onLogin: (user: any) => void }> };
const fetchMock = vi.fn();
const loggedIn = vi.fn();
const account = { id: "account-1", username: "staff.test", nombre: "Cuenta sintética", email: "staff@example.test", rol: "LECTOR", puedeCargarNominas: false };
const success = { ok: true, status: 200, json: async () => ({ data: { user: account, expiresAt: "2026-11-20T12:00:00Z" } }) };
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue(success); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Inicio de sesión con usuario o correo", () => {
  it.each(["staff.test", "STAFF@example.test"])("envía %s desde el formulario real al servicio de autenticación", async (identifier) => {
    render(createElement(Login, { onLogin: loggedIn })); const user = userEvent.setup();
    const login = screen.getByLabelText("Usuario o correo electrónico") as HTMLInputElement;
    expect(login.type).toBe("text"); expect(login.autocomplete).toBe("username"); expect(login.maxLength).toBe(254);
    await user.type(login, ` ${identifier} `);
    await user.type(screen.getByLabelText("Contraseña"), " password-with-spaces ");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    await waitFor(() => expect(loggedIn).toHaveBeenCalledWith(account));
    expect(fetchMock.mock.calls[0][0]).toContain("/api/auth/login");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: identifier, password: " password-with-spaces " });
  });

  it("permite mostrar y ocultar la contraseña sin alterar el correo ni enviar el formulario", async () => {
    render(createElement(Login, { onLogin: loggedIn })); const user = userEvent.setup();
    await user.type(screen.getByLabelText("Usuario o correo electrónico"), "staff@example.test");
    const password = screen.getByLabelText("Contraseña") as HTMLInputElement;
    await user.type(password, "test-password");
    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" })); expect(password.type).toBe("text");
    await user.click(screen.getByRole("button", { name: "Ocultar contraseña" })); expect(password.type).toBe("password");
    expect(password.value).toBe("test-password"); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("presenta el rechazo genérico y conserva la entrada para poder corregirla", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { code: "INVALID_CREDENTIALS", message: "Datos de acceso incorrectos.", details: [] } }) });
    render(createElement(Login, { onLogin: loggedIn })); const user = userEvent.setup();
    await user.type(screen.getByLabelText("Usuario o correo electrónico"), "staff@example.test");
    await user.type(screen.getByLabelText("Contraseña"), "incorrect");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Datos de acceso incorrectos.");
    expect(loggedIn).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Usuario o correo electrónico") as HTMLInputElement).value).toBe("staff@example.test");
    await user.clear(screen.getByLabelText("Contraseña")); await user.type(screen.getByLabelText("Contraseña"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    await waitFor(() => expect(loggedIn).toHaveBeenCalledWith(account));
  });
});
