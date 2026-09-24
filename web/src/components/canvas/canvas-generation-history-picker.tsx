import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, Modal, Spin } from "antd";
import { FileAudio, FileVideo, Image as ImageIcon, Search } from "lucide-react";

import { generationTaskMode } from "@/lib/canvas/canvas-generation-task-sync";
import { localTaskHistoryFromProjects } from "@/lib/local-task-history";
import { ownedResourceIdFromMediaRef, resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { listGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";

type CanvasGenerationHistoryPickerProps = {
    open: boolean;
    projectId: string;
    onClose: () => void;
    onSelect: (task: GenerationTask) => void;
};

export function CanvasGenerationHistoryPicker({ open, projectId, onClose, onSelect }: CanvasGenerationHistoryPickerProps) {
    const [keyword, setKeyword] = useState("");
    const projects = useCanvasStore((state) => state.projects);
    const localMode = isLocalWorkspaceMode();
    const query = useQuery({
        queryKey: ["canvas-generation-history", projectId, localMode, projects.map((project) => project.updatedAt).join(",")],
        queryFn: () => localMode ? Promise.resolve(localTaskHistoryFromProjects(projects).filter((task) => task.projectId === projectId)) : listGenerationTasks(100, { projectId, activeOnly: false }),
        enabled: open && Boolean(projectId),
        staleTime: 15_000,
    });
    const tasks = useMemo(() => {
        const normalized = keyword.trim().toLocaleLowerCase();
        return (query.data || [])
            .filter((task) => task.status === "succeeded")
            .filter((task) => ["image", "video", "audio"].includes(generationTaskMode(task)))
            .filter((task) => localMode ? Boolean(task.previewUrl || task.textDraft) : Boolean(task.resultJson))
            .filter((task) => !normalized || `${task.prompt} ${task.model || ""}`.toLocaleLowerCase().includes(normalized))
            .slice(0, 60);
    }, [keyword, localMode, query.data]);

    return (
        <Modal open={open} title="从生成历史选择" footer={null} onCancel={onClose} width={720} destroyOnHidden>
            <Input allowClear prefix={<Search className="size-3.5" />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索提示词或模型" aria-label="搜索生成历史" />
            <div className="mt-3 max-h-[min(560px,65vh)] overflow-y-auto pr-1">
                {query.isLoading ? <div className="grid min-h-40 place-items-center"><Spin /></div> : tasks.length ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {tasks.map((task) => <HistoryTaskCard key={task.id} task={task} onSelect={() => onSelect(task)} />)}
                    </div>
                ) : (
                    <div className="grid min-h-24 place-items-center rounded-lg border border-dashed border-border/70 text-sm text-foreground/55">
                        {query.isError ? "生成历史暂时无法读取" : "暂无可插入的生成结果"}
                    </div>
                )}
            </div>
        </Modal>
    );
}

function HistoryTaskCard({ task, onSelect }: { task: GenerationTask; onSelect: () => void }) {
    const mode = generationTaskMode(task);
    const preview = generationHistoryPreviewImageSrc(task);
    const Icon = mode === "video" ? FileVideo : mode === "audio" ? FileAudio : ImageIcon;
    return (
        <button type="button" className="group overflow-hidden rounded-lg border border-border/70 bg-surface text-left transition hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onSelect} aria-label={`插入${modeLabel(mode)}：${task.prompt.slice(0, 40)}`}>
            <div className="relative aspect-video overflow-hidden bg-surface-tertiary">
                {preview ? <img src={preview} alt="生成结果预览" loading="lazy" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-foreground/45"><Icon className="size-7" /></div>}
                <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{modeLabel(mode)}</span>
            </div>
            <div className="truncate px-2 py-2 text-xs text-foreground/80" title={task.prompt}>{task.prompt || "无提示词"}</div>
        </button>
    );
}

function modeLabel(mode: string) {
    return mode === "video" ? "视频" : mode === "audio" ? "音频" : "图片";
}

export function generationHistoryPreviewImageSrc(task: GenerationTask) {
    const mode = generationTaskMode(task);
    if (mode === "audio") return "";
    if (mode === "video") {
        const poster = task.previewPosterUrl || previewPosterFromResult(task);
        return durableImagePreviewSrc(poster);
    }
    const preview = task.previewPosterUrl || task.previewUrl || previewFromResult(task);
    return durableImagePreviewSrc(preview) || resourcePreviewFromResult(task);
}

function durableImagePreviewSrc(value: string) {
    if (!value || value.startsWith("blob:")) return "";
    return isImagePreviewSrc(value) ? value : "";
}

function resourcePreviewFromResult(task: GenerationTask) {
    if (generationTaskMode(task) !== "image" || !task.resultJson) return "";
    try {
        const result = JSON.parse(task.resultJson) as { images?: Array<{ storageKey?: string; dataUrl?: string; url?: string }> };
        const image = result.images?.[0];
        const resourceId = resourceIdFromStorageKey(image?.storageKey) || ownedResourceIdFromMediaRef(image?.storageKey, image?.dataUrl || image?.url);
        return resourceId ? resourceFileUrl(resourceId) : "";
    } catch {
        return "";
    }
}

function isImagePreviewSrc(value: string) {
    if (!value) return false;
    const lower = value.toLowerCase();
    if (lower.startsWith("data:image/")) return true;
    if (lower.startsWith("data:")) return false;
    if (/\.(mp3|wav|m4a|aac|ogg|flac|mp4|webm|mov|mkv)(?:\?|$)/i.test(lower)) return false;
    return true;
}

function previewPosterFromResult(task: GenerationTask) {
    if (!task.resultJson) return "";
    try {
        const result = JSON.parse(task.resultJson) as { video?: { previewUrl?: string; posterUrl?: string } };
        return result.video?.previewUrl || result.video?.posterUrl || "";
    } catch {
        return "";
    }
}

function previewFromResult(task: GenerationTask) {
    if (!task.resultJson) return "";
    try {
        const result = JSON.parse(task.resultJson) as { images?: Array<{ dataUrl?: string; url?: string }>; video?: { previewUrl?: string; dataUrl?: string; url?: string }; audio?: { dataUrl?: string; url?: string } };
        const mode = generationTaskMode(task);
        if (mode === "image") return result.images?.[0]?.dataUrl || result.images?.[0]?.url || "";
        if (mode === "video") return result.video?.previewUrl || "";
        return "";
    } catch {
        return "";
    }
}
