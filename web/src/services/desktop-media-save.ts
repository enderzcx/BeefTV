import { saveAs } from "file-saver";

import { sanitizeDownloadFileName } from "@/lib/canvas/canvas-media-download";

export type OwnedMediaSaveResult = "saved" | "cancelled";

export function isWailsNativeShell() {
    if (typeof window === "undefined") return false;
    return window.location?.protocol === "wails:" || typeof window.go?.main?.DesktopApp?.SaveOwnedMedia === "function";
}

export async function downloadOwnedOrBrowserMedia(options: {
    fileName: string;
    resourceId?: string;
    browserUrl?: string;
}): Promise<OwnedMediaSaveResult> {
    const fileName = sanitizeDownloadFileName(options.fileName);
    if (isWailsNativeShell()) {
        const resourceId = options.resourceId?.trim();
        if (!resourceId) throw new Error("没有可导出的本机文件");
        const save = window.go?.main?.DesktopApp?.SaveOwnedMedia;
        if (!save) throw new Error("当前应用还不能把文件存到所选位置");
        const saved = await save(fileName, resourceId);
        return saved ? "saved" : "cancelled";
    }
    const browserUrl = options.browserUrl?.trim();
    if (!browserUrl) throw new Error("没有可导出的文件");
    saveAs(browserUrl, fileName);
    return "saved";
}

export function reportOwnedMediaSave(
    message: { success: (text: string) => void; error: (text: string) => void },
    result: Promise<OwnedMediaSaveResult>,
) {
    return result
        .then((status) => {
            if (status === "saved" && isWailsNativeShell()) message.success("已保存到所选位置");
        })
        .catch((error) => {
            message.error(error instanceof Error && error.message.trim() ? error.message : "保存没有完成，请再试一次");
        });
}
