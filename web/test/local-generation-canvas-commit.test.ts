import { expect, test } from "bun:test";

import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import type { Asset } from "../src/stores/use-asset-store";

test("generation canvas commit supplies the asset that owns a node resource even when assetId is missing", async () => {
    const module = await import("../src/services/local-workspace-repository");
    const select = (module as unknown as { canvasGenerationCommitAssets?: (project: CanvasProject, assets: Asset[]) => Asset[] }).canvasGenerationCommitAssets;
    const bind = (module as unknown as { bindCanvasGenerationCommitAssets?: (project: CanvasProject, assets: Asset[]) => CanvasProject }).bindCanvasGenerationCommitAssets;
    expect(typeof select).toBe("function");
    expect(typeof bind).toBe("function");

    const project = {
        id: "canvas",
        nodes: [{ id: "node", type: "image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { taskId: "task", storageKey: "resource:generated", content: "/api/resources/generated/file" } }],
        connections: [],
    } as unknown as CanvasProject;
    const matching = {
        id: "generation-result", kind: "image", title: "生成图片", coverUrl: "/api/resources/generated/file", tags: ["生成"], status: "confirmed", source: "生成任务",
        metadata: { source: "generation-task", taskId: "task" },
        data: { dataUrl: "/api/resources/generated/file", storageKey: "resource:generated", width: 1024, height: 1024, bytes: 1, mimeType: "image/png" },
        createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
    } as Asset;
    const unrelated = { ...matching, id: "other", data: { ...matching.data, storageKey: "resource:other" } } as Asset;

    expect(select!(project, [unrelated, matching]).map((asset) => asset.id)).toEqual(["generation-result"]);
    expect(bind!(project, [unrelated, matching]).nodes[0]?.metadata?.assetId).toBe("generation-result");
});
