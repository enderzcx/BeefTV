import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { assertUsableSegmentOutput, buildRemoveAudioArgs, MUTED_VIDEO_OUTPUT_NAME, SEGMENT_INPUT_NAME } from "../src/lib/canvas/canvas-video-segment-args";

const QA_SOURCE = "/Volumes/ExternalWork/Scratch/beeftv-enterprise-20260924/mac-qa-connect-data/resources/users/3d85020570bfb684fc57a19ab71678c1/video/2026/09/24/fef9656fd70a4843bf4f87e092cbd58c.mp4";

function commandExists(name: string) {
    const result = spawnSync(name, ["-version"], { encoding: "utf8" });
    return result.status === 0;
}

const hasFfmpeg = commandExists("ffmpeg") && commandExists("ffprobe");

function runFfmpeg(cwd: string, args: string[]) {
    const result = spawnSync("ffmpeg", ["-y", ...args], { cwd, encoding: "utf8" });
    if (result.status !== 0) {
        throw new Error(result.stderr || `ffmpeg exited ${result.status}`);
    }
}

function probe(path: string) {
    const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,nb_streams:stream=codec_type,codec_name,nb_frames", "-of", "json", path], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "ffprobe failed");
    return JSON.parse(result.stdout) as { streams?: Array<{ codec_type?: string; codec_name?: string; nb_frames?: string }>; format?: { duration?: string; nb_streams?: string | number } };
}

function makeLongGopFixture(dir: string) {
    const path = join(dir, "fixture-long-gop.mp4");
    runFfmpeg(dir, [
        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=4",
        "-c:v", "libx264", "-g", "48", "-keyint_min", "48", "-pix_fmt", "yuv420p",
        "-output_ts_offset", "1.25",
        "-an",
        path,
    ]);
    return path;
}

describe.skipIf(!hasFfmpeg)("remove-audio ffmpeg args on real media", () => {
    test("full-source copy of a long-GOP video-only fixture keeps a decodable stream", () => {
        const dir = mkdtempSync(join(tmpdir(), "beeftv-segment-"));
        try {
            copyFileSync(makeLongGopFixture(dir), join(dir, SEGMENT_INPUT_NAME));
            runFfmpeg(dir, buildRemoveAudioArgs("0", "4", MUTED_VIDEO_OUTPUT_NAME, { fullSource: true }));
            const output = join(dir, MUTED_VIDEO_OUTPUT_NAME);
            const bytes = readFileSync(output);
            assertUsableSegmentOutput(bytes, "video");
            const info = probe(output);
            expect(Number(info.format?.nb_streams)).toBeGreaterThan(0);
            expect(info.streams?.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264")).toBe(true);
            expect(Number(info.format?.duration)).toBeGreaterThan(3);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("partial range re-encodes instead of emitting an empty copy", () => {
        const dir = mkdtempSync(join(tmpdir(), "beeftv-segment-"));
        try {
            copyFileSync(makeLongGopFixture(dir), join(dir, SEGMENT_INPUT_NAME));
            runFfmpeg(dir, buildRemoveAudioArgs("1", "1.25"));
            const output = join(dir, MUTED_VIDEO_OUTPUT_NAME);
            assertUsableSegmentOutput(readFileSync(output), "video");
            const info = probe(output);
            expect(info.streams?.some((stream) => stream.codec_type === "video")).toBe(true);
            const duration = Number(info.format?.duration);
            expect(duration).toBeGreaterThan(1);
            expect(duration).toBeLessThan(1.6);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("QA source full-source mute keeps the 720 square picture stream", () => {
        if (!existsSync(QA_SOURCE)) return;
        const dir = mkdtempSync(join(tmpdir(), "beeftv-segment-qa-"));
        try {
            copyFileSync(QA_SOURCE, join(dir, SEGMENT_INPUT_NAME));
            runFfmpeg(dir, buildRemoveAudioArgs("0", "6.04", MUTED_VIDEO_OUTPUT_NAME, { fullSource: true }));
            const output = join(dir, MUTED_VIDEO_OUTPUT_NAME);
            const bytes = readFileSync(output);
            assertUsableSegmentOutput(bytes, "video");
            expect(bytes.byteLength).toBeGreaterThan(400_000);
            const info = probe(output);
            expect(Number(info.format?.nb_streams)).toBe(1);
            expect(info.streams?.[0]?.codec_type).toBe("video");
            expect(Number(info.format?.duration)).toBeGreaterThan(6);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
