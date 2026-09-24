import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

describe("canvas loading node actions", () => {
    test("exposes a cancel action only for queued or running tasks", () => {
        const content = readFileSync(resolve(root, "src/components/canvas/canvas-node-content.tsx"), "utf8");
        expect(content).toContain('aria-label="取消生成任务"');
        expect(content).toContain('(displayTask.status === "queued" || displayTask.status === "running")');
    });

    test("resolves node task ids through the page task list", () => {
        const project = readFileSync(resolve(root, "src/pages/canvas/project.tsx"), "utf8");
        expect(project).toContain('activeTasks.find((item) => item.id === node.metadata?.taskId)');
        expect(project).toContain("cancelCanvasTask(task)");
    });
});
