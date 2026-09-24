import { describe, expect, test } from "bun:test";

import {
    applyInlineVideoTrimMetadata,
    moveInlineVideoTrimRange,
    normalizeInlineVideoTrimRange,
} from "../src/lib/canvas/canvas-video-inline-trim";

describe("inline video trim range", () => {
    test("keeps a 100ms minimum selection while clamping both handles to the source", () => {
        expect(normalizeInlineVideoTrimRange({ startMs: -500, endMs: 40 }, 12_000)).toEqual({ startMs: 0, endMs: 100 });
        expect(normalizeInlineVideoTrimRange({ startMs: 11_980, endMs: 15_000 }, 12_000)).toEqual({ startMs: 11_900, endMs: 12_000 });
    });

    test("moves the whole selection without changing its duration or crossing source bounds", () => {
        expect(moveInlineVideoTrimRange({ startMs: 2_000, endMs: 5_000 }, -4_000, 12_000)).toEqual({ startMs: 0, endMs: 3_000 });
        expect(moveInlineVideoTrimRange({ startMs: 8_000, endMs: 11_000 }, 4_000, 12_000)).toEqual({ startMs: 9_000, endMs: 12_000 });
    });
});

describe("inline video trim metadata", () => {
    test("replaces the current media while retaining the original source and selected range", () => {
        const metadata = applyInlineVideoTrimMetadata(
            {
                content: "blob:original",
                storageKey: "resources/original",
                durationMs: 12_000,
                naturalWidth: 1920,
                naturalHeight: 1080,
                assetId: "old-asset",
                prompt: "uploaded clip",
            },
            {
                content: "blob:trimmed",
                storageKey: "resources/trimmed",
                durationMs: 3_000,
                naturalWidth: 1920,
                naturalHeight: 1080,
            },
            { startMs: 2_000, endMs: 5_000 },
        );

        expect(metadata).toMatchObject({
            content: "blob:trimmed",
            storageKey: "resources/trimmed",
            durationMs: 3_000,
            assetId: undefined,
            prompt: "uploaded clip",
            videoTrimStartMs: 2_000,
            videoTrimEndMs: 5_000,
            videoTrimSource: {
                content: "blob:original",
                storageKey: "resources/original",
                durationMs: 12_000,
                naturalWidth: 1920,
                naturalHeight: 1080,
            },
        });
    });
});
