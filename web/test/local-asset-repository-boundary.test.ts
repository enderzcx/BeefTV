import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/services/workspace-asset-repository.ts", import.meta.url), "utf8");

test("local asset persistence wins over a stale remote sync flag", () => {
    expect(source).toContain("if (isLocalWorkspaceMode() || !hasRemoteUserDataSyncSession()) {");
    expect(source).toContain("await flushAssetStorePersistence();");
    expect(source).not.toContain("if (!hasRemoteUserDataSyncSession()) {");
});
