// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { IssueArtifactFile } from "./IssueArtifactCard";
import { loadArtifactCsv } from "@/lib/artifact-card-data";
import { TextAttachmentContext } from "@/context/TextAttachmentContext";

vi.mock("@/lib/artifact-card-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/artifact-card-data")>()),
  loadArtifactCsv: vi.fn(),
}));

describe("CSV preview consent", () => {
  it("does not fetch any CSV until its preview is requested", async () => {
    const load = vi
      .mocked(loadArtifactCsv)
      .mockResolvedValue({
        columns: ["Name"],
        rows: [["Actual row"]],
        truncated: false,
      });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const openText = vi.fn();
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <TextAttachmentContext.Provider value={openText}>
              {Array.from({ length: 20 }, (_, i) => (
                <IssueArtifactFile
                  key={i}
                  id={`csv-${i}`}
                  attachmentId={`attachment-${i}`}
                  title={`Data ${i}`}
                  summary=""
                  author=""
                  updatedAt="Today"
                  filename={`report-${i}.csv`}
                  contentType="text/csv"
                  contentPath={`/api/attachments/csv-${i}/content`}
                  downloadPath={`/api/attachments/csv-${i}/content?download=1`}
                  byteSize={100}
                />
              ))}
            </TextAttachmentContext.Provider>
          </QueryClientProvider>,
        ),
      );
      expect(load).not.toHaveBeenCalled();
      const open = container.querySelector<HTMLButtonElement>('button[aria-label="預覽 report-0.csv"]');
      await act(async () => open!.click());
      expect(openText).toHaveBeenCalledWith("attachment-0", "report-0.csv");
      expect(load).not.toHaveBeenCalled();
      expect(container.querySelectorAll('[data-testid="attachment-file-card"]')).toHaveLength(20);
      expect(container.querySelector("a[download]")).toBeNull();
      expect(load).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      client.clear();
      container.remove();
      vi.clearAllMocks();
    }
  });
});
