// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/api/client";
import { authApi } from "@/api/auth";
import {
  enablePushNotifications,
  environmentForAppId,
  getStoredPushBinding,
  pushIssuePath,
  revokePushNotifications,
  syncPushToken,
  usePushNotifications,
} from "./push-notifications";

const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
const del = vi.spyOn(api, "delete").mockResolvedValue(undefined);
const get = vi.spyOn(api, "get").mockResolvedValue([]);
const getSession = vi.spyOn(authApi, "getSession");

function installNative(overrides: Record<string, unknown> = {}) {
  const messaging = {
    checkPermissions: vi.fn().mockResolvedValue({ receive: "prompt" }),
    requestPermissions: vi.fn().mockResolvedValue({ receive: "granted" }),
    getToken: vi.fn().mockResolvedValue({ token: "token-1" }),
    deleteToken: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
    ...((overrides.messaging as Record<string, unknown> | undefined) ?? {}),
  };
  const app = { getInfo: vi.fn().mockResolvedValue({ id: "work.metabiz.crew.uat" }), addListener: vi.fn<(event: string, callback: (payload: unknown) => void) => Promise<{ remove: () => Promise<void> }>>().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }) };
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: {
      isNativePlatform: () => true,
      registerPlugin: (name: string) => name === "App" ? app : messaging,
    },
  });
  return { messaging, app };
}

describe("push notifications", () => {
  beforeEach(() => {
    localStorage.clear();
    post.mockClear();
    del.mockClear();
    get.mockClear();
    getSession.mockResolvedValue({ user: { id: "user-1" } } as Awaited<ReturnType<typeof authApi.getSession>>);
    post.mockImplementation(async () => undefined);
    del.mockImplementation(async () => undefined);
    get.mockImplementation(async () => [] as never);
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
  });

  afterEach(() => vi.clearAllMocks());

  it("maps only the two known native app ids", () => {
    expect(environmentForAppId("work.metabiz.crew.uat")).toBe("uat");
    expect(environmentForAppId("work.metabiz.crew")).toBe("production");
    expect(environmentForAppId("https://shared-host")).toBeNull();
  });

  it("does not request permission or send a registration in a browser", async () => {
    await expect(enablePushNotifications({ userId: "user-1", companyId: "company-1" })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps opt-in binding scoped to the user and company", async () => {
    const { messaging } = installNative();
    await enablePushNotifications({ userId: "user-1", companyId: "company-1" });
    expect(post).toHaveBeenCalledWith("/companies/company-1/push-devices", expect.objectContaining({
      installationId: expect.any(String),
      appId: "work.metabiz.crew.uat",
      environment: "uat",
    }));
    expect(messaging.addListener).toHaveBeenCalledWith("apnsTokenReceived", expect.any(Function));
    expect(messaging.addListener).toHaveBeenCalledWith("tokenReceived", expect.any(Function));
    expect(getStoredPushBinding()).toMatchObject({ userId: "user-1", companyId: "company-1", environment: "uat" });
    installNative();
    getSession.mockResolvedValue({ user: { id: "user-2" } } as Awaited<ReturnType<typeof authApi.getSession>>);
    await enablePushNotifications({ userId: "user-2", companyId: "company-1" });
    expect(getStoredPushBinding()).toMatchObject({ userId: "user-2", companyId: "company-1" });
  });

  it("requests permission and registers automatically after the first native login", async () => {
    const { messaging } = installNative();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let controls: ReturnType<typeof usePushNotifications> | undefined;
    const Harness = () => {
      controls = usePushNotifications({
        userId: "user-1",
        companyId: "company-1",
        companies: [{ id: "company-1", issuePrefix: "PAP" }],
        navigate: vi.fn(),
      });
      return null;
    };
    const root = createRoot(container);
    await act(async () => root.render(createElement(Harness)));
    expect(messaging.addListener).toHaveBeenCalledWith("apnsTokenReceived", expect.any(Function));
    expect(messaging.addListener).toHaveBeenCalledWith("tokenReceived", expect.any(Function));
    expect(messaging.requestPermissions).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
    expect(controls?.enabled).toBe(true);
    expect(getStoredPushBinding()).toMatchObject({ userId: "user-1", companyId: "company-1" });
    await act(async () => root.unmount());
    container.remove();
  });

  it("does not register before login or when native permission is denied", async () => {
    const { messaging } = installNative({ messaging: { checkPermissions: vi.fn().mockResolvedValue({ receive: "denied" }) } });
    const root = createRoot(document.createElement("div"));
    const Harness = ({ userId }: { userId: string | null }) => {
      usePushNotifications({ userId, companyId: "company-1", companies: [], navigate: vi.fn() });
      return null;
    };
    await act(async () => root.render(createElement(Harness, { userId: null })));
    expect(messaging.checkPermissions).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Harness, { userId: "user-1" })));
    expect(messaging.checkPermissions).toHaveBeenCalledOnce();
    expect(messaging.requestPermissions).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("retries registration on resume but preserves a manual opt-out across remounts", async () => {
    const { app } = installNative();
    post.mockRejectedValueOnce(new Error("offline"));
    const pushToast = vi.fn();
    let controls: ReturnType<typeof usePushNotifications> | undefined;
    const Harness = () => {
      controls = usePushNotifications({ userId: "user-1", companyId: "company-1", companies: [], navigate: vi.fn(), pushToast });
      return null;
    };
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    expect(getStoredPushBinding()).toBeNull();
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "手機通知尚未啟用" }));
    const onResume = app.addListener.mock.calls[0]?.[1] as unknown as (state: unknown) => void;
    await act(async () => onResume({ isActive: true }));
    expect(getStoredPushBinding()).toMatchObject({ userId: "user-1", companyId: "company-1" });
    await act(async () => { await controls?.disable(); });
    await act(async () => root.unmount());
    post.mockClear();
    const nextRoot = createRoot(document.createElement("div"));
    await act(async () => nextRoot.render(createElement(Harness)));
    expect(post).not.toHaveBeenCalled();
    expect(controls?.enabled).toBe(false);
    await act(async () => nextRoot.unmount());
  });

  it("does not re-register on resume while logout is revoking the device", async () => {
    const { app } = installNative();
    const root = createRoot(document.createElement("div"));
    const Harness = () => {
      usePushNotifications({ userId: "user-1", companyId: "company-1", companies: [], navigate: vi.fn() });
      return null;
    };
    await act(async () => root.render(createElement(Harness)));
    post.mockClear();
    const onResume = app.addListener.mock.calls[0]?.[1] as unknown as (state: unknown) => void;
    await act(async () => {
      const revoking = revokePushNotifications();
      onResume({ isActive: true });
      await revoking;
    });
    expect(post).not.toHaveBeenCalled();
    expect(getStoredPushBinding()).toBeNull();
    await act(async () => root.unmount());
  });

  it("does not bind a token when the session changes during permission registration", async () => {
    installNative();
    getSession.mockResolvedValue({ user: { id: "user-2" } } as Awaited<ReturnType<typeof authApi.getSession>>);
    await expect(enablePushNotifications({ userId: "user-1", companyId: "company-1" })).rejects.toThrow("登入帳號已變更");
    expect(post).not.toHaveBeenCalled();
    expect(getStoredPushBinding()).toBeNull();
  });

  it("serializes enable and disable so a double tap cannot leave a binding behind", async () => {
    localStorage.setItem("paperclip.push-opt-out-user:user-1", "disabled");
    const { messaging } = installNative();
    let resolveToken: ((value: { token: string }) => void) | undefined;
    messaging.getToken = vi.fn().mockReturnValue(new Promise((resolve) => { resolveToken = resolve; }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    let controls: ReturnType<typeof usePushNotifications> | undefined;
    const Harness = () => {
      controls = usePushNotifications({ userId: "user-1", companyId: "company-1", companies: [], navigate: vi.fn() });
      return null;
    };
    const root = createRoot(container);
    await act(async () => root.render(createElement(Harness)));
    let enabling: Promise<unknown> | undefined;
    await act(async () => { enabling = controls?.enable(); });
    const disabling = controls?.disable();
    expect(del).not.toHaveBeenCalled();
    resolveToken?.({ token: "token-1" });
    await act(async () => { await enabling; await disabling; });
    expect(post).toHaveBeenCalledOnce();
    expect(del).toHaveBeenCalledOnce();
    expect(getStoredPushBinding()).toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });

  it("rejects permission denial and invalid notification deep links", async () => {
    const { messaging } = installNative({ messaging: { requestPermissions: vi.fn().mockResolvedValue({ receive: "denied" }) } });
    await expect(enablePushNotifications({ userId: "user-1", companyId: "company-1" })).rejects.toThrow("拒絕");
    expect(post).not.toHaveBeenCalled();
    expect(pushIssuePath({ companyId: "company-1", issueId: "not-a-uuid" }, [{ id: "company-1", issuePrefix: "PAP" }], "user-1")).toBeNull();
    expect(pushIssuePath(
      { companyId: "11111111-1111-4111-8111-111111111111", issueId: "22222222-2222-4222-8222-222222222222" },
      [{ id: "11111111-1111-4111-8111-111111111111", issuePrefix: "PAP" }],
      "user-1",
    )).toBe("/PAP/issues/22222222-2222-4222-8222-222222222222");
    expect(messaging.getToken).not.toHaveBeenCalled();
  });

  it("revokes server registration before deleting the native token", async () => {
    const { messaging } = installNative();
    await enablePushNotifications({ userId: "user-1", companyId: "company-1" });
    await revokePushNotifications();
    expect(del).toHaveBeenCalledWith(expect.stringMatching(/^\/push-devices\//));
    expect(messaging.deleteToken).toHaveBeenCalledOnce();
    expect(getStoredPushBinding()).toBeNull();
  });

  it("rotates the token only for the stored opt-in binding", async () => {
    installNative();
    await enablePushNotifications({ userId: "user-1", companyId: "company-1" });
    post.mockClear();
    await syncPushToken("token-2");
    expect(post).toHaveBeenCalledWith("/companies/company-1/push-devices", expect.objectContaining({ token: "token-2" }));
    localStorage.clear();
    post.mockClear();
    getSession.mockResolvedValue({ user: { id: "user-2" } } as Awaited<ReturnType<typeof authApi.getSession>>);
    await syncPushToken("token-3");
    expect(post).not.toHaveBeenCalled();
    getSession.mockResolvedValue({ user: { id: "user-1" } } as Awaited<ReturnType<typeof authApi.getSession>>);
    await syncPushToken("token-4", { userId: "user-2", companyId: "company-1" });
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps the binding when server revoke fails, so logout can be retried", async () => {
    installNative();
    await enablePushNotifications({ userId: "user-1", companyId: "company-1" });
    del.mockRejectedValueOnce(new Error("offline"));
    await expect(revokePushNotifications()).rejects.toThrow("offline");
    expect(getStoredPushBinding()).not.toBeNull();
  });
});
