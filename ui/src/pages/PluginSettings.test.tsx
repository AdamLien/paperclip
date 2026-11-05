// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import { PluginSettings } from "./PluginSettings";
import { ApiError } from "../api/client";

const mockPluginsApi = vi.hoisted(() => ({
  get: vi.fn(),
  health: vi.fn(),
  dashboard: vi.fn(),
  logs: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  initializeConfig: vi.fn(),
  listLocalFolders: vi.fn(),
  configureLocalFolder: vi.fn(),
}));

const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockCompany = vi.hoisted(() => ({
  selectedCompany: { id: "company-1", name: "Paperclip", issuePrefix: "PAP" } as { id: string; name: string; issuePrefix: string } | null,
  selectedCompanyId: "company-1" as string | null,
}));

vi.mock("@/api/plugins", () => ({
  pluginsApi: mockPluginsApi,
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: mockSetBreadcrumbs,
  }),
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => mockCompany,
}));

vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  Navigate: () => null,
  useParams: () => ({ companyPrefix: "PAP", pluginId: "plugin-1" }),
}));

vi.mock("@/plugins/slots", () => ({
  PluginSlotMount: () => null,
  usePluginSlots: () => ({ slots: [] }),
}));

vi.mock("@/components/PageTabBar", () => ({
  PageTabBar: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function basePlugin(overrides: Record<string, unknown> = {}) {
  return {
    id: "plugin-1",
    pluginKey: "paperclip.e2b-sandbox-provider",
    packageName: "@paperclipai/plugin-e2b",
    version: "0.1.0",
    status: "error",
    categories: ["automation"],
    manifestJson: {
      displayName: "E2B Sandbox Provider",
      version: "0.1.0",
      description: "E2B environments for Paperclip.",
      author: "Paperclip",
      capabilities: ["environment.drivers.register"],
      environmentDrivers: [
        {
          driverKey: "e2b",
          kind: "sandbox_provider",
          displayName: "E2B Cloud Sandbox",
        },
      ],
    },
    lastError: null,
    ...overrides,
  };
}

function wikiFolderDeclaration() {
  return {
    folderKey: "wiki-root",
    displayName: "Wiki root",
    description: "Company-scoped local folder that stores wiki files.",
    access: "readWrite" as const,
    requiredDirectories: ["raw", "wiki"],
    requiredFiles: ["WIKI.md", "index.md"],
  };
}

function wikiWithBackgroundJob() {
  return basePlugin({
    pluginKey: "paperclipai.plugin-llm-wiki",
    packageName: "@paperclipai/plugin-llm-wiki",
    status: "ready",
    manifestJson: {
      displayName: "LLM Wiki", version: "0.1.0", description: "Local-file wiki.", author: "Paperclip",
      capabilities: ["local.folders", "jobs.schedule"],
      localFolders: [wikiFolderDeclaration()],
      jobs: [{ jobKey: "wiki-index-sync", displayName: "Sync wiki index", schedule: "*/5 * * * *" }],
    },
  });
}

function folderStatus(overrides: Record<string, unknown> = {}) {
  return {
    folderKey: "wiki-root",
    configured: false,
    path: null,
    realPath: null,
    access: "readWrite",
    readable: false,
    writable: false,
    requiredDirectories: ["raw", "wiki"],
    requiredFiles: ["WIKI.md", "index.md"],
    missingDirectories: ["raw", "wiki"],
    missingFiles: ["WIKI.md", "index.md"],
    healthy: false,
    problems: [{ code: "not_configured", message: "No local folder path is configured." }],
    checkedAt: "2026-05-02T16:00:00.000Z",
    ...overrides,
  };
}

async function renderSettings(
  container: HTMLDivElement,
  experimentalSettings: Record<string, unknown> = {},
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const root = createRoot(container);
  // The local-folders section is a host-path surface, so it stays hidden until
  // the managed-sandbox-only policy is known. Seed the policy as off; the tests
  // below are about folder rendering, not about the gate.
  queryClient.setQueryData(queryKeys.instance.experimentalSettings, experimentalSettings);

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <PluginSettings />
      </QueryClientProvider>,
    );
  });
  await flushReact();
  await flushReact();
  return root;
}

describe("PluginSettings", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockCompany.selectedCompany = { id: "company-1", name: "Paperclip", issuePrefix: "PAP" };
    mockCompany.selectedCompanyId = "company-1";

    mockPluginsApi.get.mockResolvedValue(basePlugin());
    mockPluginsApi.dashboard.mockResolvedValue(null);
    mockPluginsApi.health.mockResolvedValue({ pluginId: "plugin-1", status: "ready", healthy: true, checks: [] });
    mockPluginsApi.logs.mockResolvedValue([]);
    mockPluginsApi.getConfig.mockResolvedValue(null);
    mockPluginsApi.saveConfig.mockImplementation(async (_pluginId, companyId, configJson) => ({ id: "config-1", companyId, configJson }));
    mockPluginsApi.initializeConfig.mockImplementation(async (_pluginId, companyId) => ({ id: "config-1", companyId, configJson: {} }));
    mockPluginsApi.listLocalFolders.mockResolvedValue({
      pluginId: "plugin-1",
      companyId: "company-1",
      declarations: [],
      folders: [],
    });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("routes environment-provider plugins to instance environments when they have no instance config", async () => {
    const root = await renderSettings(container);

    expect(container.textContent).toContain("Configure this plugin from Settings → Environments.");
    expect(container.textContent).toContain("secret bindings still resolve through the selected organization context");
    const link = container.querySelector('a[href="/company/settings/instance/environments"]');
    expect(link?.textContent).toContain("Open Environments");

    await act(async () => {
      root.unmount();
    });
  });

  it("initializes background configuration without a schema only for the selected organization", async () => {
    mockPluginsApi.get.mockResolvedValue(wikiWithBackgroundJob());
    const root = await renderSettings(container);
    try {
      const button = Array.from(container.querySelectorAll("button"))
        .find((node) => node.textContent === "Initialize background configuration");
      expect(button).toBeDefined();
      expect(button?.disabled).toBe(false);
      await act(async () => { button!.click(); });
      await flushReact();
      expect(mockPluginsApi.initializeConfig).toHaveBeenCalledExactlyOnceWith("plugin-1", "company-1");
      expect(mockPluginsApi.saveConfig).not.toHaveBeenCalled();
      expect(mockPluginsApi.configureLocalFolder).not.toHaveBeenCalled();
      expect(container.textContent).toContain("Background configuration is saved for this organization.");
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it("shows an existing background config without replacing its values", async () => {
    mockPluginsApi.get.mockResolvedValue(wikiWithBackgroundJob());
    mockPluginsApi.getConfig.mockResolvedValue({ id: "config-existing", companyId: "company-1", configJson: { keep: "value" } });
    const root = await renderSettings(container);
    try {
      expect(container.textContent).toContain("Background configuration is saved for this organization.");
      expect(container.textContent).not.toContain("Initialize background configuration");
      expect(mockPluginsApi.initializeConfig).not.toHaveBeenCalled();
      expect(mockPluginsApi.saveConfig).not.toHaveBeenCalled();
      expect(mockPluginsApi.configureLocalFolder).not.toHaveBeenCalled();
    } finally { await act(async () => { root.unmount(); }); }
  });

  it("shows the instance-admin requirement when initialization returns 403", async () => {
    mockPluginsApi.get.mockResolvedValue(wikiWithBackgroundJob());
    mockPluginsApi.initializeConfig.mockRejectedValue(new ApiError("Permission denied", 403, {}));
    const root = await renderSettings(container);
    try {
      const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "Initialize background configuration")!;
      await act(async () => { button.click(); });
      await flushReact();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("An instance administrator must initialize background configuration. Nothing was changed.");
      expect(container.textContent).not.toContain("Background configuration is saved for this organization.");
      expect(button.disabled).toBe(false);
    } finally { await act(async () => { root.unmount(); }); }
  });

  it("does not initialize when existing configuration cannot be read", async () => {
    mockPluginsApi.get.mockResolvedValue(wikiWithBackgroundJob());
    mockPluginsApi.getConfig.mockRejectedValue(new Error("Network unavailable"));
    const root = await renderSettings(container);
    try {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not load background configuration. Nothing was changed.");
      expect(container.textContent).not.toContain("Initialize background configuration");
      expect(mockPluginsApi.initializeConfig).not.toHaveBeenCalled();
    } finally { await act(async () => { root.unmount(); }); }
  });

  it("waits for configuration to load and prevents duplicate initialization while saving", async () => {
    mockPluginsApi.get.mockResolvedValue(wikiWithBackgroundJob());
    let finishRead!: (value: null) => void;
    let finishSave!: (value: unknown) => void;
    mockPluginsApi.getConfig.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    mockPluginsApi.initializeConfig.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const root = await renderSettings(container);
    try {
      let button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "Initialize background configuration")!;
      expect(button.disabled).toBe(true);
      await act(async () => { finishRead(null); });
      await flushReact();
      expect(button.disabled).toBe(false);
      await act(async () => { button.click(); });
      await flushReact();
      button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "Initializing...")!;
      expect(button.disabled).toBe(true);
      await act(async () => { button.click(); });
      expect(mockPluginsApi.initializeConfig).toHaveBeenCalledTimes(1);
      await act(async () => { finishSave({ id: "config-1", companyId: "company-1", configJson: {} }); });
      await flushReact();
      expect(container.textContent).toContain("Background configuration is saved for this organization.");
    } finally { await act(async () => { root.unmount(); }); }
  });

  it("requires a selected organization before reading or initializing background configuration", async () => {
    mockPluginsApi.get.mockResolvedValue(wikiWithBackgroundJob());
    mockCompany.selectedCompany = null;
    mockCompany.selectedCompanyId = null;
    const root = await renderSettings(container);
    try {
      expect(container.textContent).toContain("Select an organization before initializing background configuration.");
      expect(mockPluginsApi.getConfig).not.toHaveBeenCalled();
      expect(mockPluginsApi.initializeConfig).not.toHaveBeenCalled();
    } finally { await act(async () => { root.unmount(); }); }
  });

  it("does not apply an old organization's save result to the newly selected organization", async () => {
    mockPluginsApi.get.mockResolvedValue(wikiWithBackgroundJob());
    let finishSave!: (value: unknown) => void;
    mockPluginsApi.initializeConfig.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = await renderSettings(container, {}, client);
    try {
      const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "Initialize background configuration")!;
      await act(async () => { button.click(); });
      await flushReact();
      mockCompany.selectedCompany = { id: "company-2", name: "Second organization", issuePrefix: "TWO" };
      mockCompany.selectedCompanyId = "company-2";
      await act(async () => { root.render(<QueryClientProvider client={client}><PluginSettings /></QueryClientProvider>); });
      await flushReact();
      await act(async () => { finishSave({ id: "config-1", companyId: "company-1", configJson: {} }); });
      await flushReact();
      expect(container.textContent).toContain("Second organization");
      expect(container.textContent).not.toContain("Background configuration is saved for this organization.");
      expect(container.textContent).toContain("Initialize background configuration");
      expect(mockPluginsApi.initializeConfig).toHaveBeenCalledExactlyOnceWith("plugin-1", "company-1");
      expect(client.getQueryData(queryKeys.plugins.config("plugin-1", "company-2"))).toBeNull();
    } finally { await act(async () => { root.unmount(); }); }
  });

  it("keeps schema-backed configuration on its normal form instead of initialization", async () => {
    const plugin = wikiWithBackgroundJob();
    mockPluginsApi.get.mockResolvedValue({ ...plugin, manifestJson: { ...plugin.manifestJson, instanceConfigSchema: { type: "object", properties: { label: { type: "string" } } } } });
    const root = await renderSettings(container);
    try {
      expect(container.textContent).toContain("Save Configuration");
      expect(container.textContent).not.toContain("Initialize background configuration");
    } finally { await act(async () => { root.unmount(); }); }
  });

  it("renders unconfigured manifest local folders with required paths", async () => {
    const declaration = wikiFolderDeclaration();
    mockPluginsApi.get.mockResolvedValue(basePlugin({
      pluginKey: "paperclipai.plugin-llm-wiki",
      packageName: "@paperclipai/plugin-llm-wiki",
      status: "ready",
      manifestJson: {
        displayName: "LLM Wiki",
        version: "0.1.0",
        description: "Local-file LLM Wiki plugin.",
        author: "Paperclip",
        capabilities: ["local.folders"],
        localFolders: [declaration],
      },
    }));
    mockPluginsApi.listLocalFolders.mockResolvedValue({
      pluginId: "plugin-1",
      companyId: "company-1",
      declarations: [declaration],
      folders: [folderStatus()],
    });

    const root = await renderSettings(container);

    expect(container.textContent).toContain("Local folders");
    expect(container.textContent).toContain("Wiki root");
    expect(container.textContent).toContain("Needs attention");
    expect(container.textContent).toContain("No local folder path is configured.");
    expect(container.textContent).toContain("Missing directories: raw, wiki");
    expect(container.textContent).toContain("Missing files: WIKI.md, index.md");

    await act(async () => {
      root.unmount();
    });
  });

  it("hides local folders when the instance runs agents only in the platform-managed environment", async () => {
    const declaration = wikiFolderDeclaration();
    mockPluginsApi.get.mockResolvedValue(basePlugin({
      pluginKey: "paperclipai.plugin-llm-wiki",
      packageName: "@paperclipai/plugin-llm-wiki",
      status: "ready",
      manifestJson: {
        displayName: "LLM Wiki",
        version: "0.1.0",
        description: "Local-file LLM Wiki plugin.",
        author: "Paperclip",
        capabilities: ["local.folders"],
        localFolders: [declaration],
      },
    }));
    mockPluginsApi.listLocalFolders.mockResolvedValue({
      pluginId: "plugin-1",
      companyId: "company-1",
      declarations: [declaration],
      folders: [folderStatus()],
    });

    const root = await renderSettings(container, { enableManagedSandboxOnly: true });

    // The platform-managed environment owns the filesystem, so the whole
    // section disappears rather than showing paths nobody can act on.
    expect(container.textContent).not.toContain("Local folders");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders invalid configured folders with validation problems", async () => {
    const declaration = wikiFolderDeclaration();
    mockPluginsApi.get.mockResolvedValue(basePlugin({
      manifestJson: {
        displayName: "LLM Wiki",
        version: "0.1.0",
        description: "Local-file LLM Wiki plugin.",
        author: "Paperclip",
        capabilities: ["local.folders"],
        localFolders: [declaration],
      },
    }));
    mockPluginsApi.listLocalFolders.mockResolvedValue({
      pluginId: "plugin-1",
      companyId: "company-1",
      declarations: [declaration],
      folders: [folderStatus({
        configured: true,
        path: "/tmp/wiki",
        realPath: "/tmp/wiki",
        readable: true,
        writable: true,
        missingDirectories: [],
        missingFiles: ["WIKI.md"],
        problems: [{ code: "missing_file", message: "Required file is missing.", path: "WIKI.md" }],
      })],
    });

    const root = await renderSettings(container);

    expect(container.textContent).toContain("/tmp/wiki");
    expect(container.textContent).toContain("ReadableYes");
    expect(container.textContent).toContain("WritableYes");
    expect(container.textContent).toContain("Validation problems");
    expect(container.textContent).toContain("Required file is missing.");
    expect(container.textContent).toContain("Missing files: WIKI.md");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not render required paths as present when the configured root cannot be inspected", async () => {
    const declaration = wikiFolderDeclaration();
    mockPluginsApi.get.mockResolvedValue(basePlugin({
      manifestJson: {
        displayName: "LLM Wiki",
        version: "0.1.0",
        description: "Local-file LLM Wiki plugin.",
        author: "Paperclip",
        capabilities: ["local.folders"],
        localFolders: [declaration],
      },
    }));
    mockPluginsApi.listLocalFolders.mockResolvedValue({
      pluginId: "plugin-1",
      companyId: "company-1",
      declarations: [declaration],
      folders: [folderStatus({
        configured: true,
        path: "/tmp/wiki-missing",
        readable: false,
        writable: false,
        missingDirectories: [],
        missingFiles: [],
        problems: [{ code: "missing", message: "Configured local folder cannot be inspected.", path: "/tmp/wiki-missing" }],
      })],
    });

    const root = await renderSettings(container);

    expect(container.textContent).toContain("Configured local folder cannot be inspected.");
    expect(container.textContent).toContain("Not inspected");
    expect(container.textContent).toContain("Configured root was not inspected.");
    expect(container.textContent).not.toContain("Present");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders healthy folders without validation problems", async () => {
    const declaration = wikiFolderDeclaration();
    mockPluginsApi.get.mockResolvedValue(basePlugin({
      manifestJson: {
        displayName: "LLM Wiki",
        version: "0.1.0",
        description: "Local-file LLM Wiki plugin.",
        author: "Paperclip",
        capabilities: ["local.folders"],
        localFolders: [declaration],
      },
    }));
    mockPluginsApi.listLocalFolders.mockResolvedValue({
      pluginId: "plugin-1",
      companyId: "company-1",
      declarations: [declaration],
      folders: [folderStatus({
        configured: true,
        path: "/tmp/wiki",
        realPath: "/private/tmp/wiki",
        readable: true,
        writable: true,
        missingDirectories: [],
        missingFiles: [],
        healthy: true,
        problems: [],
      })],
    });

    const root = await renderSettings(container);

    expect(container.textContent).toContain("Healthy");
    expect(container.textContent).toContain("Configured path");
    expect(container.textContent).toContain("/tmp/wiki");
    expect(container.textContent).toContain("ReadableYes");
    expect(container.textContent).toContain("WritableYes");
    expect(container.textContent).toContain("Present");
    expect(container.textContent).not.toContain("Validation problems");

    await act(async () => {
      root.unmount();
    });
  });
});
