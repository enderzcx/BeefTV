import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasVideoInlineTrim, CanvasVideoInlineTrimOverlay } from "../src/components/canvas/canvas-video-inline-trim";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const videoNode: CanvasNodeData = {
    id: "video-1",
    type: CanvasNodeType.Video,
    title: "街采替换",
    position: { x: 0, y: 0 },
    width: 720,
    height: 1280,
    metadata: { content: "blob:video", durationMs: 12_000, naturalWidth: 720, naturalHeight: 1280, hasAudio: true },
};

describe("CanvasVideoInlineTrim", () => {
    test("renders a LibTV-style filmstrip range editor with accessible cancel and confirm actions", () => {
        const html = renderToStaticMarkup(
            <CanvasVideoInlineTrim node={videoNode} busy={false} onCancel={() => {}} onConfirm={() => {}} />,
        );

        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-label="视频片段剪辑"');
        expect(html).toContain('data-video-trim-filmstrip="true"');
        expect(html).toContain('aria-label="调整片段起点"');
        expect(html).toContain('aria-label="调整片段终点"');
        expect(html).toContain('aria-label="取消剪辑"');
        expect(html).toContain('aria-label="确认剪辑"');
        expect(html).toContain("12.00 s");
    });

    test("renders inside the target node panel and sizes from the rendered video width", () => {
        const html = renderToStaticMarkup(
            <CanvasVideoInlineTrimOverlay
                node={videoNode}
                viewport={{ x: 0, y: 0, k: 0.5 }}
                containerRef={createRef<HTMLDivElement>()}
                busy={false}
                onCancel={() => {}}
                onConfirm={() => {}}
            />,
        );

        expect(html).toContain("data-canvas-node-panel");
        expect(html).toContain('style="left:0;top:0;transform:translate3d(');
        expect(html).toContain("width:540px");
        expect(html).toContain('aria-label="视频片段剪辑"');
    });
});
