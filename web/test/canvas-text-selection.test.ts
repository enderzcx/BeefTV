import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const source = readFileSync(new URL("../src/components/canvas/canvas-node-content.tsx", import.meta.url), "utf8");
const textContent = source.slice(source.indexOf("function TextContent("), source.indexOf("function ", source.indexOf("function TextContent(") + 1));

describe("text node selection (#429)", () => {
    test("media generators open the generation panel while all media results use tools", () => {
        const project = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        const clickHandler = project.slice(project.indexOf("const handleSelectedNodeClick ="), project.indexOf("const handleNodeBringToFront ="));
        expect(clickHandler).toContain("node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio");
        expect(clickHandler).toMatch(/canOpenCanvasNodePromptPanel\(node\)[\s\S]*?setToolbarNodeId\(null\);[\s\S]*?setDialogNodeId\(node\.id\);[\s\S]*?setDialogNodeId\(null\);[\s\S]*?setToolbarNodeId\(node\.id\);/);
    });

    test("dragging a populated media node cannot reopen its generation panel", () => {
        const project = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        const dragHandler = project.slice(project.indexOf("const handleNodeDragEnd ="), project.indexOf("const handleCanvasDeselect ="));
        expect(dragHandler).toContain("canOpenCanvasNodePromptPanel(node)");
        expect(dragHandler).toContain("setDialogNodeId(null)");
    });

    test("the render boundary rejects stale dialog state for result media", () => {
        const project = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        expect(project).toContain("canOpenCanvasNodePromptPanel(dialogNodeCandidate) ? dialogNodeCandidate : null");
    });

    test("opens the text generation panel on a node click", () => {
        const project = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        const clickHandler = project.slice(project.indexOf("const handleSelectedNodeClick ="), project.indexOf("const handleNodeBringToFront ="));
        expect(clickHandler).toMatch(/node.type === CanvasNodeType.Text\)\s*\{\s*setDialogNodeId\(node.id\)/);
    });

    test("allows plain and rich text previews to reach node selection", () => {
        const preview = textContent.split(") : richTextHTML ? (")[1];
        expect(preview).toBeDefined();
        expect(preview).not.toContain("onMouseDown");
        expect(preview).not.toContain("onPointerDown");
        expect(preview?.match(/onWheel=/g)).toHaveLength(2);
    });

    test("keeps editing gestures isolated from canvas dragging", () => {
        const editor = textContent.split(") : richTextHTML ? (")[0];
        expect(editor).toContain("onMouseDown={(event) => event.stopPropagation()}");
        expect(editor).toContain("onPointerDown={(event) => event.stopPropagation()}");
    });
});
