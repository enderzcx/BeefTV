import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const picker = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-generation-history-picker.tsx"), "utf8");
const definitions = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/tool-registry/definitions/add-node-menu-tools.tsx"), "utf8");
const project = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
const localHistory = readFileSync(resolve(import.meta.dir, "../src/lib/local-task-history.ts"), "utf8");

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
    });
});
