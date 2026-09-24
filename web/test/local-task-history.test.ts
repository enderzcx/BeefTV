import { describe, expect, test } from "bun:test";

import { localTaskHistoryFromProjects } from "../src/lib/local-task-history";
import { CanvasNodeType } from "../src/types/canvas";

describe("local task history", () => {
    test("derives a completed local task from a persisted canvas node", () => {
        const tasks = localTaskHistoryFromProjects([
            {
                id: "canvas-1",
                title: "本地画布",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:01:00.000Z",
                nodes: [{
                    id: "node-1",
                    type: CanvasNodeType.Image,
                    title: "山间镜头",
                    position: { x: 0, y: 0 },
                    width: 320,
                    height: 240,
                    metadata: { prompt: "生成山间镜头", status: "success", content: "data:image/png;base64,local", taskCompletedAt: "2026-01-01T00:01:00.000Z" },
                }],
                connections: [],
                chatSessions: [],
                activeChatId: null,
                backgroundMode: "dots",
                showImageInfo: false,
                viewport: { x: 0, y: 0, k: 1 },
                directorScenes: [],
            },
        ]);

        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ id: "local:canvas-1:node-1", status: "succeeded", type: "canvas_image", projectId: "canvas-1", previewKind: "image" });
    });
});
