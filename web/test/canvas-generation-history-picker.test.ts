import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { generationHistoryPreviewImageSrc } from "../src/components/canvas/canvas-generation-history-picker";
import { reuseGeneratedMediaStorageKey } from "../src/lib/canvas/canvas-generation-task-sync";
import type { GenerationTask } from "../src/services/api/task-center";

const picker = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-generation-history-picker.tsx"), "utf8");
const definitions = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/tool-registry/definitions/add-node-menu-tools.tsx"), "utf8");
const project = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
const localHistory = readFileSync(resolve(import.meta.dir, "../src/lib/local-task-history.ts"), "utf8");
const taskSync = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/canvas-generation-task-sync.ts"), "utf8");

describe("LibTV generation history picker", () => {
    test("queries and filters successful media generation tasks", () => {
        expect(picker).toContain('title="从生成历史选择"');
        expect(picker).toContain("listGenerationTasks");
        expect(picker).toContain('task.status === "succeeded"');
        expect(picker).toContain("Boolean(task.resultJson)");
        expect(picker).toContain("onSelect(task)");
    });

    test("is exposed from the add-node menu and applies the result to a canvas node", () => {
        expect(definitions).toContain('id: "generation-history"');
        expect(definitions).toContain("onOpenGenerationHistory");
        expect(project).toContain("applyGenerationTaskResultToNodes");
        expect(project).toContain("insertGenerationHistoryTask");
        expect(localHistory).toContain("localResultJson");
        expect(localHistory).toContain("resultJson");
        expect(localHistory).toContain("storageKey");
        expect(project).toContain("setGenerationHistoryOpen(false)");
        expect(taskSync).toContain("reuseGeneratedMediaStorageKey");
        expect(taskSync).toContain("reuseAudioKey");
        expect(taskSync).toContain("reuseVideoKey");
        expect(taskSync).toContain("reuseImageKey");
    });

    test("persists the inserted node to the local canvas document before closing success", () => {
        const insertStart = project.indexOf("const insertGenerationHistoryTask");
        const insertEnd = project.indexOf("handleReplaceNodeReference", insertStart);
        const insert = project.slice(insertStart, insertEnd);
        expect(insert).toContain("bindCanvasNodeResourceAsset");
        expect(insert).toContain("canvasNodesMissingResourceAssetBinding");
        expect(insert).toContain("ensureCanvasNodeAsset");
        expect(insert).toContain("insertingHistoryRef");
        expect(insert).toContain("await persistCanvasDocument(projectId, { nodes: nextNodes })");
        expect(insert.indexOf("await persistCanvasDocument")).toBeGreaterThan(-1);
        expect(insert.indexOf("await persistCanvasDocument")).toBeLessThan(insert.indexOf("setGenerationHistoryOpen(false)"));
        expect(insert.indexOf("await persistCanvasDocument")).toBeLessThan(insert.indexOf('message.success("已从生成历史插入到画布")'));
        expect(insert.indexOf("flushCanvasStorePersistence")).toBe(-1);
        expect(insert.indexOf("saveCanvasProject")).toBe(-1);
    });

    test("does not use audio or video file URLs as card image sources", () => {
        const audioUrl = "http://127.0.0.1:3184/api/resources/audio-owned/file";
        const audioTask = {
            id: "task-audio",
            projectId: "7vvfM674HnenwTekmj88V",
            type: "canvas_audio",
            status: "succeeded",
            prompt: "一段旁白",
            previewUrl: audioUrl,
            resultJson: JSON.stringify({ mode: "audio", audio: { dataUrl: audioUrl, url: audioUrl, storageKey: "resource:audio-owned" } }),
            attempts: 1,
            createdAt: "2026-09-24T00:00:00.000Z",
            updatedAt: "2026-09-24T00:00:00.000Z",
        } as GenerationTask;
        const videoTask = {
            ...audioTask,
            id: "task-video",
            type: "canvas_video",
            previewUrl: "http://127.0.0.1:3184/api/resources/video-owned/file",
            resultJson: JSON.stringify({ mode: "video", video: { dataUrl: "http://127.0.0.1:3184/api/resources/video-owned/file" } }),
        } as GenerationTask;
        const imageTask = {
            ...audioTask,
            id: "task-image",
            type: "canvas_image",
            previewUrl: "data:image/png;base64,abc",
            resultJson: JSON.stringify({ mode: "image", images: [{ dataUrl: "data:image/png;base64,abc" }] }),
        } as GenerationTask;

        expect(generationHistoryPreviewImageSrc(audioTask)).toBe("");
        expect(generationHistoryPreviewImageSrc(videoTask)).toBe("");
        expect(generationHistoryPreviewImageSrc(imageTask)).toBe("data:image/png;base64,abc");
        const staleImageTask = {
            ...imageTask,
            id: "task-stale-image",
            previewUrl: "blob:http://127.0.0.1/expired",
            resultJson: JSON.stringify({ mode: "image", images: [{ dataUrl: "blob:http://127.0.0.1/expired", storageKey: "resource:image-owned" }] }),
        } as GenerationTask;
        expect(generationHistoryPreviewImageSrc(staleImageTask)).toContain("/resources/image-owned/file");
        expect(reuseGeneratedMediaStorageKey(undefined, audioUrl)).toBe("resource:audio-owned");
        expect(reuseGeneratedMediaStorageKey("image:local-1", "http://127.0.0.1:3184/api/resources/video-owned/file")).toBe("image:local-1");
        expect(reuseGeneratedMediaStorageKey(undefined, "data:audio/mpeg;base64,AAA")).toBe("");
    });
});
