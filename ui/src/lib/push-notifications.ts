import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { authApi } from "@/api/auth";
import { Capacitor as BundledCapacitor } from "@capacitor/core";

export type PushEnvironment = "uat" | "production";
export type PushPlatform = "ios" | "android";

export interface PushBinding {
  installationId: string;
  userId: string;
  companyId: string;
  environment: PushEnvironment;
  appId: "work.metabiz.crew.uat" | "work.metabiz.crew";
}

interface PushDevice {
  installationId: string;
  token: string;
  platform: PushPlatform;
  appId: PushBinding["appId"];
  environment: PushEnvironment;
}

interface CapacitorPlugin {
  addListener?: (event: string, callback: (payload: unknown) => void) => Promise<{ remove: () => Promise<void> }>;
  requestPermissions?: () => Promise<{ receive: "granted" | "denied" | "prompt" }>;
  checkPermissions?: () => Promise<{ receive: "granted" | "denied" | "prompt" }>;
  getToken?: () => Promise<{ token: string }>;
  deleteToken?: () => Promise<void>;
  getInfo?: () => Promise<{ id?: string }>;
}

interface CapacitorRuntime {
  isNativePlatform?: () => boolean;
  registerPlugin?: (name: string) => CapacitorPlugin;
}

const STORAGE_KEY = "paperclip.push-binding";
const OPT_OUT_KEY = "paperclip.push-opt-out-user";
const UAT_APP_ID = "work.metabiz.crew.uat" as const;
const PRODUCTION_APP_ID = "work.metabiz.crew" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let pushOperation: Promise<void> = Promise.resolve();
let automaticRegistrationBlocked = false;

function withPushOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = pushOperation.then(operation, operation);
  pushOperation = next.then(() => undefined, () => undefined);
  return next;
}

function runtime(): CapacitorRuntime | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { Capacitor?: CapacitorRuntime }).Capacitor
    ?? (BundledCapacitor as unknown as CapacitorRuntime);
}

export function isNativePushAvailable(): boolean {
  return Boolean(runtime()?.isNativePlatform?.() && runtime()?.registerPlugin);
}

function plugins() {
  const current = runtime();
  if (!current?.registerPlugin || !current.isNativePlatform?.()) return null;
  return {
    app: current.registerPlugin("App"),
    messaging: current.registerPlugin("FirebaseMessaging"),
  };
}

function readBinding(): PushBinding | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as PushBinding | null;
    return value && UUID.test(value.installationId) ? value : null;
  } catch {
    return null;
  }
}

function writeBinding(binding: PushBinding) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(binding));
}

function clearBinding() {
  localStorage.removeItem(STORAGE_KEY);
}

function installationId(): string {
  const existing = localStorage.getItem("paperclip.push-installation-id");
  if (existing && UUID.test(existing)) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem("paperclip.push-installation-id", created);
  return created;
}

export function getStoredPushBinding(): PushBinding | null {
  return readBinding();
}

export function environmentForAppId(appId: string | undefined): PushEnvironment | null {
  if (appId === UAT_APP_ID) return "uat";
  if (appId === PRODUCTION_APP_ID) return "production";
  return null;
}

async function nativeIdentity(native: { app: CapacitorPlugin }) {
  const appInfo = await native.app.getInfo?.();
  const appId = appInfo?.id === UAT_APP_ID || appInfo?.id === PRODUCTION_APP_ID ? appInfo.id : null;
  const environment = environmentForAppId(appId ?? undefined);
  if (!appId || !environment) throw new Error("無法辨識目前的原生環境。");
  return { appId, environment };
}

function platform(): PushPlatform {
  return /android/i.test(navigator.userAgent) ? "android" : "ios";
}

function devicePath(companyId: string) {
  return `/companies/${encodeURIComponent(companyId)}/push-devices`;
}

async function enablePushNotificationsInternal(input: { userId: string; companyId: string }): Promise<PushBinding> {
  const native = plugins();
  if (!native?.app.getInfo || !native.messaging.requestPermissions || !native.messaging.getToken || !native.messaging.checkPermissions) {
    throw new Error("原生通知功能目前無法使用。");
  }
  const { appId, environment } = await nativeIdentity(native);

  const apnsHandle = native.messaging.addListener
    ? await native.messaging.addListener("apnsTokenReceived", markApnsTokenReady)
    : null;
  const tokenHandle = native.messaging.addListener
    ? await native.messaging.addListener("tokenReceived", () => undefined)
    : null;
  let token: string;
  try {
    const previous = readBinding();
    if (previous && (previous.userId !== input.userId || previous.companyId !== input.companyId || previous.appId !== appId)) {
      await revokeBinding(previous);
    }
    let permission = await native.messaging.checkPermissions();
    if (permission.receive !== "granted") permission = await native.messaging.requestPermissions();
    if (permission.receive !== "granted") throw new Error("你拒絕了任務完成通知權限。");
    if (isIos() && !apnsTokenReady) await waitForApnsToken();
    ({ token } = await native.messaging.getToken());
  } finally {
    await apnsHandle?.remove();
    await tokenHandle?.remove();
  }
  if (!token) throw new Error("無法取得任務完成通知識別碼。");

  const binding: PushBinding = {
    installationId: installationId(),
    ...input,
    environment,
    appId,
  };
  const session = await authApi.getSession();
  if (session?.user.id !== input.userId) throw new Error("登入帳號已變更，請重新啟用通知。");
  await api.post(devicePath(input.companyId), {
    installationId: binding.installationId,
    token,
    platform: platform(),
    appId,
    environment,
  });
  writeBinding(binding);
  localStorage.removeItem(`${OPT_OUT_KEY}:${input.userId}`);
  return binding;
}

export function enablePushNotifications(input: { userId: string; companyId: string }): Promise<PushBinding> {
  automaticRegistrationBlocked = false;
  return withPushOperation(() => enablePushNotificationsInternal(input));
}

export function revokePushNotifications(): Promise<void> {
  automaticRegistrationBlocked = true;
  return withPushOperation(revokePushNotificationsInternal);
}

async function revokePushNotificationsInternal(): Promise<void> {
  const binding = readBinding();
  if (!binding) return;
  await revokeBinding(binding);
}

async function revokeBinding(binding: PushBinding): Promise<void> {
  if (!isNativePushAvailable()) {
    if (readBinding()?.installationId === binding.installationId) clearBinding();
    return;
  }
  const native = plugins();
  try {
    await api.delete(`/push-devices/${encodeURIComponent(binding.installationId)}`);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    await api.delete(`${devicePath(binding.companyId)}/${encodeURIComponent(binding.installationId)}`);
  }
  if (native?.messaging.deleteToken) await native.messaging.deleteToken();
  if (readBinding()?.installationId === binding.installationId) clearBinding();
}

let apnsTokenReady = false;
const apnsWaiters = new Set<() => void>();

function markApnsTokenReady() {
  apnsTokenReady = true;
  for (const resolve of apnsWaiters) resolve();
  apnsWaiters.clear();
}

function isIos() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function waitForApnsToken(): Promise<void> {
  if (apnsTokenReady) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timeout);
      apnsWaiters.delete(done);
      resolve();
    };
    const timeout = window.setTimeout(done, 1500);
    apnsWaiters.add(done);
  });
}

export async function syncPushToken(token: string, expected?: { userId: string; companyId: string }) {
  const binding = readBinding();
  if (automaticRegistrationBlocked || !binding || !token) return;
  if (expected && (binding.userId !== expected.userId || binding.companyId !== expected.companyId)) return;
  const session = await authApi.getSession();
  if (automaticRegistrationBlocked || !session || session.user.id !== binding.userId || (expected && session.user.id !== expected.userId)) return;
  await api.post(devicePath(binding.companyId), {
    installationId: binding.installationId,
    token,
    platform: platform(),
    appId: binding.appId,
    environment: binding.environment,
  });
}

export function pushIssuePath(payload: unknown, companies: Array<{ id: string; issuePrefix: string }>, userId: string | null): string | null {
  if (!userId || !payload || typeof payload !== "object") return null;
  const data = payload as { companyId?: unknown; issueId?: unknown };
  if (typeof data.companyId !== "string" || !UUID.test(data.companyId)) return null;
  if (typeof data.issueId !== "string" || !UUID.test(data.issueId)) return null;
  const company = companies.find((item) => item.id === data.companyId);
  return company ? `/${company.issuePrefix}/issues/${data.issueId}` : null;
}

export function usePushNotifications(input: {
  userId: string | null;
  companyId: string | null;
  companies: Array<{ id: string; issuePrefix: string }>;
  navigate: (path: string) => void;
  pushToast?: (input: { title: string; body?: string; tone?: "error" | "success" }) => unknown;
}) {
  const [enabled, setEnabled] = useState(() => {
    const binding = readBinding();
    return Boolean(binding && binding.userId === input.userId && binding.companyId === input.companyId);
  });
  const [pending, setPending] = useState(false);
  const lifecycleRevision = useRef(0);
  const companiesRef = useRef(input.companies);
  companiesRef.current = input.companies;
  const callbacksRef = useRef(input);
  callbacksRef.current = input;
  const current = useMemo(() => ({ userId: input.userId, companyId: input.companyId }), [input.userId, input.companyId]);

  useEffect(() => {
    const revision = ++lifecycleRevision.current;
    if (!isNativePushAvailable() || !current.userId || !current.companyId) return;
    automaticRegistrationBlocked = false;
    const userId = current.userId;
    const companyId = current.companyId;
    let active = true;
    let handles: Array<{ remove: () => Promise<void> }> = [];
    const setup = async () => {
      const native = plugins();
      if (!native?.messaging.addListener || !native.app.getInfo) return;
      const identity = await nativeIdentity(native);
      const binding = readBinding();
      if (binding && (binding.userId !== current.userId || binding.companyId !== current.companyId || binding.appId !== identity.appId)) {
        await revokeBinding(binding);
      }
      if (!active || revision !== lifecycleRevision.current) return;
      setEnabled(Boolean(readBinding()?.userId === current.userId && readBinding()?.companyId === current.companyId));
      const registeredHandles = await Promise.all([
      native.messaging.addListener("apnsTokenReceived", markApnsTokenReady),
      native.messaging.addListener("tokenReceived", (payload) => {
        const token = payload && typeof payload === "object" && "token" in payload
          ? (payload as { token?: unknown }).token
          : undefined;
        if (active && typeof token === "string") void syncPushToken(token, { userId, companyId }).catch(() => undefined);
      }),
      native.messaging.addListener("notificationActionPerformed", (payload) => {
        const notification = payload && typeof payload === "object" && "notification" in payload
          ? (payload as { notification?: { data?: unknown } }).notification
          : undefined;
        const path = pushIssuePath(notification?.data ?? payload, companiesRef.current, userId);
        if (active && path) void authApi.getSession().then((session) => {
          if (active && session?.user.id === userId) callbacksRef.current.navigate(path);
        }).catch(() => undefined);
      }),
      ]);
      if (!active || revision !== lifecycleRevision.current) {
        await Promise.all(registeredHandles.map((handle) => handle.remove()));
        return;
      }
      handles = registeredHandles;
      const reconcile = () => withPushOperation(async () => {
        if (!active || automaticRegistrationBlocked || revision !== lifecycleRevision.current) return;
        const session = await authApi.getSession();
        if (!active || automaticRegistrationBlocked || session?.user.id !== userId) return;
        const permission = await native.messaging.checkPermissions?.();
        if (!permission) return;
        if (permission.receive === "denied") {
          await revokePushNotificationsInternal();
          if (active) setEnabled(false);
          return;
        }
        if (localStorage.getItem(`${OPT_OUT_KEY}:${userId}`) === "disabled") return;
        const result = await api.get<PushDevice[] | { devices?: PushDevice[] }>(devicePath(companyId));
        if (!active || automaticRegistrationBlocked || revision !== lifecycleRevision.current) return;
        const devices = Array.isArray(result) ? result : result.devices ?? [];
        const registered = devices.some((device) => device.installationId === readBinding()?.installationId);
        if (!registered) {
          setPending(true);
          try {
            await enablePushNotificationsInternal({ userId, companyId });
          } finally {
            if (active) setPending(false);
          }
        }
        if (active && revision === lifecycleRevision.current) setEnabled(true);
      });
      const reportError = (error: unknown) => {
        if (!active) return;
        setEnabled(false);
        callbacksRef.current.pushToast?.({
          title: "手機通知尚未啟用",
          body: error instanceof Error ? error.message : "請在帳號選單重新啟用通知。",
          tone: "error",
        });
      };
      if (native.app.addListener) {
        const handle = await native.app.addListener("appStateChange", (state) => {
          if (state && typeof state === "object" && "isActive" in state && state.isActive) {
            void reconcile().catch(reportError);
          }
        });
        if (!active) await handle.remove();
        else handles.push(handle);
      }
      await reconcile().catch(reportError);
    };
    void setup().catch(() => {
      if (active && revision === lifecycleRevision.current) setEnabled(false);
    });
    return () => {
      active = false;
      void Promise.all(handles.map((handle) => handle.remove()));
    };
  }, [current.userId, current.companyId]);

  const enable = useCallback(async () => {
    if (!current.userId || !current.companyId) return;
    setPending(true);
    try {
      await enablePushNotifications({ userId: current.userId, companyId: current.companyId });
      setEnabled(true);
      input.pushToast?.({ title: "已啟用任務完成通知", tone: "success" });
    } catch (error) {
      input.pushToast?.({ title: "無法啟用任務完成通知", body: error instanceof Error ? error.message : "請稍後再試。", tone: "error" });
      throw error;
    } finally {
      setPending(false);
    }
  }, [current, input.pushToast]);

  const disable = useCallback(async () => {
    setPending(true);
    try {
      await revokePushNotifications();
      if (current.userId) localStorage.setItem(`${OPT_OUT_KEY}:${current.userId}`, "disabled");
      setEnabled(false);
      input.pushToast?.({ title: "已關閉任務完成通知", tone: "success" });
    } catch (error) {
      input.pushToast?.({ title: "無法關閉任務完成通知", body: "通知仍保持啟用，請確認網路後再試。", tone: "error" });
      throw error;
    } finally {
      setPending(false);
    }
  }, [current.userId, input.pushToast]);

  return { available: isNativePushAvailable(), enabled, pending, enable, disable };
}
