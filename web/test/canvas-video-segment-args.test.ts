import { describe, expect, test } from "bun:test";

import { assertUsableSegmentOutput, buildCopyAudioArgs, buildExtractAudioArgs, buildRemoveAudioArgs, buildSegmentTrimArgs, isFullSourceRange, AUDIO_COPY_OUTPUT_NAME, MUTED_VIDEO_OUTPUT_NAME, SEGMENT_INPUT_NAME, SEGMENT_OUTPUT_NAME } from "../src/lib/canvas/canvas-video-segment-args";

describe("buildSegmentTrimArgs seek 顺序", () => {
    test("-ss 必须放在 -i 之后（输出 seek）：输入 seek 按关键帧对齐，切点会偏移最多一个 GOP", () => {
        const args = buildSegmentTrimArgs("10.5", "4");
        expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
        expect(args).toEqual(["-i", SEGMENT_INPUT_NAME, "-ss", "10.5", "-t", "4", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", SEGMENT_OUTPUT_NAME]);
    });
});

describe("buildExtractAudioArgs seek 顺序", () => {
    test("音频提取与裁切路径一致，同样使用输出 seek", () => {
        const args = buildExtractAudioArgs("libmp3lame", "10.5", "4");
        expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
        expect(args).toEqual(["-i", SEGMENT_INPUT_NAME, "-ss", "10.5", "-t", "4", "-vn", "-c:a", "libmp3lame", "-q:a", "2", SEGMENT_OUTPUT_NAME]);
    });
});

describe("buildCopyAudioArgs", () => {
    test("复制源音轨并显式映射第一条音频流", () => {
        expect(buildCopyAudioArgs("0", "5")).toEqual([
            "-i", SEGMENT_INPUT_NAME, "-ss", "0", "-t", "5", "-map", "0:a:0?", "-vn", "-c:a", "copy", "-movflags", "+faststart", AUDIO_COPY_OUTPUT_NAME,
        ]);
    });
});

describe("isFullSourceRange", () => {
    test("起点为 0 且覆盖片长时视为整段", () => {
        expect(isFullSourceRange(0, 6041, 6041)).toBe(true);
        expect(isFullSourceRange(0, 6041, 6042)).toBe(true);
        expect(isFullSourceRange(0, 3000, 6041)).toBe(false);
        expect(isFullSourceRange(120, 6041, 6041)).toBe(false);
        expect(isFullSourceRange(0, 6041)).toBe(false);
    });
});

describe("buildRemoveAudioArgs", () => {
    test("整段去音：不 seek，复制主视频流并跳过封面图", () => {
        expect(buildRemoveAudioArgs("0", "6.04", MUTED_VIDEO_OUTPUT_NAME, { fullSource: true })).toEqual([
            "-i", SEGMENT_INPUT_NAME, "-map", "0:V:0", "-an", "-c:v", "copy", "-movflags", "+faststart", MUTED_VIDEO_OUTPUT_NAME,
        ]);
        expect(buildRemoveAudioArgs("0", "6.04", MUTED_VIDEO_OUTPUT_NAME, { fullSource: true }).includes("-ss")).toBe(false);
    });

    test("部分区间去音：输出 seek 并重编码，不使用 stream copy", () => {
        const args = buildRemoveAudioArgs("1", "1.5");
        expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
        expect(args).toEqual([
            "-i", SEGMENT_INPUT_NAME, "-ss", "1", "-t", "1.5", "-map", "0:V:0", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", MUTED_VIDEO_OUTPUT_NAME,
        ]);
        expect(args.includes("copy")).toBe(false);
    });
});

describe("assertUsableSegmentOutput", () => {
    test("rejects empty mp4 shells that ffmpeg copy can emit as success", () => {
        expect(() => assertUsableSegmentOutput(new Uint8Array(261), "video")).toThrow(/为空或无法解码/);
        expect(() => assertUsableSegmentOutput(new Uint8Array(128), "audio")).toThrow(/输出文件为空/);
    });
});
