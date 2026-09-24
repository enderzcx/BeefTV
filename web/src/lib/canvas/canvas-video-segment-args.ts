// 视频片段处理（裁切/提音轨）的 ffmpeg 参数构造，纯函数便于单测。
// 精确裁切：-ss 放在 -i 之后并重编码。输入 seek + stream copy 只会落到关键帧，
// 任意部分区间不能靠 -c:v copy 保证切点。
// 整段去音：不要带 -ss/-t 的输出 seek copy。MP4 在 ss=0 时仍可能写出无 mdat 的空文件。
// 用 -map 0:V:0 跳过 attached pic。

export const SEGMENT_INPUT_NAME = "segment-input.mp4";
export const SEGMENT_OUTPUT_NAME = "segment-output.mp4";
export const AUDIO_OUTPUT_NAME = "segment-output.mp3";
export const WAV_OUTPUT_NAME = "segment-output.wav";
export const AUDIO_COPY_OUTPUT_NAME = "segment-output.m4a";
export const MUTED_VIDEO_OUTPUT_NAME = "segment-muted-output.mp4";
export const CROP_OUTPUT_NAME = "segment-crop-output.mp4";

/** 视频片段裁切参数：输出统一编码 MP4。 */
export function buildSegmentTrimArgs(startSec: string, durationSec: string): string[] {
    return ["-i", SEGMENT_INPUT_NAME, "-ss", startSec, "-t", durationSec, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", SEGMENT_OUTPUT_NAME];
}

/** 从视频片段提取声音：同样使用输出 seek，保证起点与裁切路径一致。 */
export function buildExtractAudioArgs(audioCodec: string, startSec: string, durationSec: string, outputName = SEGMENT_OUTPUT_NAME): string[] {
    return ["-i", SEGMENT_INPUT_NAME, "-ss", startSec, "-t", durationSec, "-vn", "-c:a", audioCodec, "-q:a", "2", outputName];
}

/** 直接复制原音轨，绕过精简内核缺少 MP3/AAC 编码器的问题。 */
export function buildCopyAudioArgs(startSec: string, durationSec: string, outputName = AUDIO_COPY_OUTPUT_NAME): string[] {
    return ["-i", SEGMENT_INPUT_NAME, "-ss", startSec, "-t", durationSec, "-map", "0:a:0?", "-vn", "-c:a", "copy", "-movflags", "+faststart", outputName];
}

export function isFullSourceRange(startMs: number, endMs: number, durationMs?: number) {
    if (startMs > 0) return false;
    if (durationMs === undefined || !(durationMs > 0)) return false;
    return endMs >= durationMs - 1;
}

const MIN_VIDEO_OUTPUT_BYTES = 4096;
const MIN_AUDIO_OUTPUT_BYTES = 256;

function containsFourcc(bytes: Uint8Array, fourcc: string) {
    const a = fourcc.charCodeAt(0);
    const b = fourcc.charCodeAt(1);
    const c = fourcc.charCodeAt(2);
    const d = fourcc.charCodeAt(3);
    for (let index = 0; index + 4 <= bytes.length; index += 1) {
        if (bytes[index] === a && bytes[index + 1] === b && bytes[index + 2] === c && bytes[index + 3] === d) return true;
    }
    return false;
}

function asBytes(output: Uint8Array | string) {
    return typeof output === "string" ? new TextEncoder().encode(output) : output;
}

export function assertUsableSegmentOutput(output: Uint8Array | string, kind: "video" | "audio") {
    const bytes = asBytes(output);
    if (kind === "audio") {
        if (bytes.byteLength < MIN_AUDIO_OUTPUT_BYTES) throw new Error("音频提取失败：输出文件为空");
        return;
    }
    if (bytes.byteLength < MIN_VIDEO_OUTPUT_BYTES || !containsFourcc(bytes, "ftyp") || !containsFourcc(bytes, "mdat")) {
        throw new Error("无声视频生成失败：输出文件为空或无法解码");
    }
}

/** 去掉原视频音轨。整段可复制画面；部分区间必须重编码，不能 stream copy。 */
export function buildRemoveAudioArgs(startSec: string, durationSec: string, outputName = MUTED_VIDEO_OUTPUT_NAME, options?: { fullSource?: boolean }): string[] {
    if (options?.fullSource) {
        return ["-i", SEGMENT_INPUT_NAME, "-map", "0:V:0", "-an", "-c:v", "copy", "-movflags", "+faststart", outputName];
    }
    return ["-i", SEGMENT_INPUT_NAME, "-ss", startSec, "-t", durationSec, "-map", "0:V:0", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", outputName];
}

/** 空间裁切视频，坐标和尺寸使用源视频像素值。 */
export function buildVideoCropArgs(x: number, y: number, width: number, height: number): string[] {
    return ["-i", SEGMENT_INPUT_NAME, "-vf", `crop=${Math.round(width)}:${Math.round(height)}:${Math.round(x)}:${Math.round(y)}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", CROP_OUTPUT_NAME];
}
