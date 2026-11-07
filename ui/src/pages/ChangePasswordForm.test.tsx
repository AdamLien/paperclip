// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authApi, AuthApiError } from "@/api/auth";
import { setLocale } from "@/i18n";
import { ChangePasswordForm } from "./ChangePasswordForm";

vi.mock("@/api/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/api/auth")>(),
  authApi: { changePassword: vi.fn() },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChangePasswordForm", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    setLocale("en");
    vi.mocked(authApi.changePassword).mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root.render(<ChangePasswordForm />); });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    setLocale("en");
    vi.restoreAllMocks();
  });

  function fill(current = "current-password", next = "next-password", confirm = next) {
    for (const [name, value] of Object.entries({ currentPassword: current, newPassword: next, confirmPassword: confirm })) {
      const input = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      expect(input).not.toBeNull();
      input.value = value;
    }
  }

  async function submit() {
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  it("offers three labeled, masked password fields with password-manager hints", () => {
    const fields = [...container.querySelectorAll<HTMLInputElement>("input")];
    expect(fields).toHaveLength(3);
    for (const field of fields) {
      expect(field.type).toBe("password");
      expect(field.required).toBe(true);
      expect(container.querySelector(`label[for="${field.id}"]`)).not.toBeNull();
    }
    expect(fields.map(field => field.autocomplete)).toEqual(["current-password", "new-password", "new-password"]);
  });

  it.each([
    ["", "next-password", "next-password"],
    ["current-password", "short", "short"],
    ["current-password", "next-password", "does-not-match"],
    ["current-password", "current-password", "current-password"],
  ])("does not send invalid or mismatched passwords", async (current, next, confirm) => {
    fill(current, next, confirm);
    await submit();
    expect(authApi.changePassword).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  it("changes the password without trimming or forwarding confirmation and clears all fields", async () => {
    fill(" current-password ", " next-password ");
    await submit();
    expect(authApi.changePassword).toHaveBeenCalledExactlyOnceWith({
      currentPassword: " current-password ", newPassword: " next-password ",
    });
    expect([...container.querySelectorAll<HTMLInputElement>("input")].every(input => input.value === "")).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Password changed");
  });

  it("prevents duplicate submission while waiting for the API", async () => {
    let finish!: () => void;
    vi.mocked(authApi.changePassword).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    fill();
    await submit();
    await submit();
    expect(authApi.changePassword).toHaveBeenCalledTimes(1);
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    await act(async () => { finish(); });
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
  });

  it("explains an incorrect current password without exposing a server response", async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue(new AuthApiError(
      "reflected-current-password next-password", 400, null, "INVALID_PASSWORD",
    ));
    fill();
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("current password is incorrect");
    expect(container.textContent).not.toContain("reflected-current-password");
    expect([...container.querySelectorAll<HTMLInputElement>("input")].every(input => input.value === "")).toBe(true);
  });

  it.each([401, 429, 500, 0])("shows a safe failure for status %s without retrying", async status => {
    vi.mocked(authApi.changePassword).mockRejectedValue(new AuthApiError("sensitive-response", status, null));
    fill();
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).not.toContain("sensitive-response");
    expect(authApi.changePassword).toHaveBeenCalledTimes(1);
  });

  it("updates the entire password form when switching to Traditional Chinese", async () => {
    await act(async () => { setLocale("zh-TW"); });
    expect(container.textContent).toContain("修改密碼");
    expect(container.textContent).toContain("目前密碼");
    expect(container.textContent).toContain("再次輸入新密碼");
  });
});
