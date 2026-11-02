import { describe, expect, it } from "vitest";
import { ASSIGNED_MCP_SERVER_NAME, boundedMcpToolName } from "./mcp-tool-names.js";

describe("provider MCP name budget", () => {
  it("keeps short names compatible", () => {
    expect(boundedMcpToolName("mcp.drive-12345678:read-file", ["connection", "read_file"]))
      .toBe("mcp.drive-12345678:read-file");
  });
  it("bounds the complete provider name and retains unique, stable aliases", () => {
    const name = `mcp.app-gallery-posthog-${"a".repeat(40)}-cb60822c:file-download-batch-exports-count-rows-create`;
    const first = boundedMcpToolName(name, ["connection-one", "file_download_batch_exports_count_rows_create"]);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(`mcp__${ASSIGNED_MCP_SERVER_NAME}__${first}`.length).toBeLessThan(128);
    expect(first).toContain("file-download");
    expect(boundedMcpToolName(name, ["connection-one", "file_download_batch_exports_count_rows_create"])).toBe(first);
    expect(boundedMcpToolName(name, ["connection-two", "file_download_batch_exports_count_rows_create"])).not.toBe(first);
  });
  it("keeps the readable tool part of a pasted-link connection name within budget", () => {
    // Pasted MCP links are namespaced by a 53-character gallery key plus the connection id.
    const name = "mcp.app-gallery-link-10d3f17f-dbd7-4c4b-9bd8-381984f63bc9-186c7d8e:metabiz-mcrm-member-growth-by-month";
    const bounded = boundedMcpToolName(name, ["connection", "metabiz_mcrm_member_growth_by_month"]);
    expect(bounded.length).toBeLessThanOrEqual(64);
    expect(bounded).toContain("metabiz-mcrm-member-growth-by");
  });
});
