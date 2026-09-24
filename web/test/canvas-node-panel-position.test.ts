import { describe, expect, test } from "bun:test";

import { getNodePanelPosition } from "@/components/canvas/canvas-workspace-overlays";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const mediaNode = {
    id: "image-node",
    type: CanvasNodeType.Image,
    position: { x: 240, y: 580 },
    width: 480,
    height: 160,
} as CanvasNodeData;

describe("canvas media prompt panel placement", () => {
    test("keeps the panel below the node even when it extends past the viewport", () => {
        const position = getNodePanelPosition(
            mediaNode,
            { x: 0, y: 0, k: 1 },
            { width: 1200, height: 700 },
            660,
            190,
            undefined,
            true,
        );

        expect(position.placement).toBe("below");
        expect(position.top).toBe(756);
    });

    test("wires the fixed-below policy to all media prompt panels", async () => {
        const source = await Bun.file(new URL("../src/pages/canvas/project.tsx", import.meta.url)).text();

        expect(source).toContain("keepBelowNode={dialogNode.type === CanvasNodeType.Image || dialogNode.type === CanvasNodeType.Video || dialogNode.type === CanvasNodeType.Audio}");
    });
});
