import { Modal, Button, Input, Popconfirm } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useEffect, useMemo, useState } from "react";

import { Clock, Clock3, ExternalLink, History, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router";

import { StatusBadge } from "@/components/ui/base/badges";

import { flushCanvasStorePersistence, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasHistoryStore } from "@/stores/canvas/use-canvas-history-store";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/product/empty-state";
import { ProjectPreview } from "@/components/canvas/canvas-project-card";

type TimelineItem = {
    id: string;
    title: string;
    isDeleted: boolean;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
    nodeCount: number;
    timelineTime: string;
    project?: CanvasProject;
};

export function CanvasHistoryDrawer({ open, onClose, initialFilter = "all" }: { open: boolean; onClose: () => void; initialFilter?: "all" | "active" | "deleted" }) {
    const navigate = useNavigate();
    const activeProjects = useCanvasStore((state) => state.projects);
    const restoreProject = useCanvasStore((state) => state.restoreProject);
    const deletedProjects = useCanvasHistoryStore((state) => state.deletedProjects);
    const removeDeletedItem = useCanvasHistoryStore((state) => state.removeDeletedHistoryItem);
    const clearDeletedHistory = useCanvasHistoryStore((state) => state.clearDeletedHistory);
    const localOnly = isLocalWorkspaceMode();
    const [keyword, setKeyword] = useState("");
    const [filter, setFilter] = useState<"all" | "active" | "deleted">(initialFilter);
    const [selectedDeleted, setSelectedDeleted] = useState<string[]>([]);

    useEffect(() => {
        if (open) {
            setFilter(initialFilter);
            setSelectedDeleted([]);
        }
    }, [initialFilter, open]);

    const timelineItems = useMemo<TimelineItem[]>(() => {
        const activeList: TimelineItem[] = activeProjects.map((p) => ({
            id: p.id,
            title: p.title || "未命名画布",
            isDeleted: false,
            createdAt: p.createdAt || p.updatedAt || new Date().toISOString(),
            updatedAt: p.updatedAt || new Date().toISOString(),
            nodeCount: p.nodes?.length || 0,
            timelineTime: p.createdAt || p.updatedAt || new Date().toISOString(),
        }));

        const deletedList: TimelineItem[] = deletedProjects.map((d) => ({
            id: d.id,
            title: d.title || "未命名画布",
            isDeleted: true,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            deletedAt: d.deletedAt,
            nodeCount: d.nodeCount,
            timelineTime: d.deletedAt || d.createdAt,
            project: d.project,
        }));

        const all = [...activeList, ...deletedList];
        all.sort((a, b) => new Date(b.timelineTime).getTime() - new Date(a.timelineTime).getTime());
        return all;
    }, [activeProjects, deletedProjects]);

    const filteredItems = useMemo(() => {
        const q = keyword.trim().toLowerCase();
        return timelineItems.filter((item) => {
            if (filter === "active" && item.isDeleted) return false;
            if (filter === "deleted" && !item.isDeleted) return false;
            if (!q) return true;
            return item.title.toLowerCase().includes(q);
        });
    }, [filter, keyword, timelineItems]);

    const openProject = (id: string) => {
        navigate(`/canvas/${id}`);
        onClose();
    };

    return (
        <Modal open={open} onCancel={onClose} footer={null} closable={false} width="100%" className="libtv-recycle-modal" maskClosable>
            <div className="libtv-recycle-shell">
                <header className="libtv-recycle-header">
                    <div className="libtv-recycle-heading"><h2>回收站</h2></div>
                    <button type="button" className="libtv-recycle-close" aria-label="关闭回收站" onClick={onClose}><X /></button>
                </header>
            <div className={cn("libtv-recycle-content", filter === "deleted" && "is-recycle-bin")}>
                {/* 回收站只保留按原卡片选择并恢复的轻量交互 */}
                <div className="space-y-3">
                    <Input allowClear prefix={<Search className="size-3.5 text-stone-400" />} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索画布名称..." className="text-xs" />
                    <div className="flex items-center gap-2 text-xs">
                        <button
                            type="button"
                            className={cn(
                                "cursor-pointer rounded-lg px-3 py-1.5 font-medium transition-all",
                                filter === "all"
                                    ? "!bg-stone-900 !text-white shadow-sm dark:!bg-stone-100 dark:!text-stone-900 font-semibold"
                                    : "bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700",
                            )}
                            onClick={() => setFilter("all")}
                        >
                            全部 ({timelineItems.length})
                        </button>
                        <button
                            type="button"
                            className={cn(
                                "cursor-pointer rounded-lg px-3 py-1.5 font-medium transition-all",
                                filter === "active"
                                    ? "!bg-emerald-600 !text-white shadow-sm font-semibold"
                                    : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50",
                            )}
                            onClick={() => setFilter("active")}
                        >
                            活跃中 ({activeProjects.length})
                        </button>
                        <button
                            type="button"
                            className={cn(
                                "cursor-pointer rounded-lg px-3 py-1.5 font-medium transition-all",
                                filter === "deleted" ? "!bg-rose-600 !text-white shadow-sm font-semibold" : "bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/50",
                            )}
                            onClick={() => setFilter("deleted")}
                        >
                            已删除 ({deletedProjects.length})
                        </button>
                    </div>
                </div>

                {/* 时间线列表 */}
                {filteredItems.length === 0 ? (
                    <div className="libtv-recycle-empty">回收站是空的</div>
                ) : (
                    <div className="libtv-recycle-grid">
                        {filteredItems.map((item) => {
                            const isDeleted = item.isDeleted;
                            const checked = selectedDeleted.includes(item.id);
                            if (filter === "deleted" && isDeleted) return (
                                <article key={item.id + (item.deletedAt || "")} className={cn("libtv-recycle-project-card", checked && "is-selected")}>
                                    <label className="libtv-recycle-checkbox">
                                        <input type="checkbox" checked={checked} onChange={(event) => setSelectedDeleted((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} aria-label={`选择 ${item.title}`} />
                                    </label>
                                    <div className="libtv-recycle-project-preview">{item.project ? <ProjectPreview project={item.project} emptyVariant="libtv" /> : <div className="canvas-project-empty is-libtv size-full" />}</div>
                                    <h3>{item.title}</h3>
                                    <p>{formatTimelineDate(item.deletedAt || item.updatedAt)}</p>
                                </article>
                            );
                            return (
                                <div key={item.id + (item.deletedAt || "")} className="libtv-recycle-card">
                                    {/* 时间轴圆点 */}
                                    <span className={cn("absolute -left-[23px] top-3.5 size-3 rounded-full border-2 border-background", isDeleted ? "bg-rose-500 ring-2 ring-rose-500/20" : "bg-emerald-500 ring-2 ring-emerald-500/20")} />

                                    <div
                                        className={cn(
                                            "rounded-xl border p-3.5 transition-all shadow-sm",
                                            isDeleted
                                                ? "border-rose-200/90 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/20 hover:border-rose-300"
                                                : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900/70 hover:border-stone-300 dark:hover:border-stone-700",
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1 space-y-1.5">
                                                <div className="flex items-center gap-2">
                                                    {isDeleted ? (
                                                        <span className="truncate text-sm font-semibold text-stone-500 line-through decoration-rose-500/80 decoration-2 dark:text-stone-400" title={item.title}>
                                                            {item.title}
                                                        </span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className="truncate text-left text-sm font-semibold text-stone-900 hover:text-blue-600 dark:text-stone-100 dark:hover:text-blue-400 transition-colors"
                                                            onClick={() => openProject(item.id)}
                                                            title={item.title}
                                                        >
                                                            {item.title}
                                                        </button>
                                                    )}
                                                    {isDeleted ? <StatusBadge tone="error" size="sm" label="已删除" className="m-0" /> : <StatusBadge tone="success" size="sm" label="活跃中" className="m-0" />}
                                                </div>

                                                <div className="space-y-1 text-xs text-stone-600 dark:text-stone-300">
                                                    <div className="flex items-center gap-1.5">
                                                        <Clock3 className="size-3.5 text-stone-400 shrink-0" />
                                                        <span>创建时间：{formatTimelineDate(item.createdAt)}</span>
                                                    </div>
                                                    {isDeleted && item.deletedAt ? (
                                                        <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-medium">
                                                            <Trash2 className="size-3.5 text-rose-500 shrink-0" />
                                                            <span>删除时间：{formatTimelineDate(item.deletedAt)}</span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1.5 text-stone-500 dark:text-stone-400">
                                                            <Clock className="size-3.5 text-stone-400 shrink-0" />
                                                            <span>最近更新：{formatTimelineDate(item.updatedAt)}</span>
                                                        </div>
                                                    )}
                                                    <div className="text-[11px] text-stone-500 dark:text-stone-400 pt-0.5">包含 {item.nodeCount} 个节点</div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1 shrink-0 pt-0.5">
                                                {!isDeleted ? (
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        icon={<ExternalLink className="size-4 text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100" />}
                                                        onClick={() => openProject(item.id)}
                                                        title="打开画布"
                                                    />
                                                ) : (
                                                    <>
                                                        {localOnly && item.project ? (
                                                            <Tooltip title="恢复到项目列表">
                                                                <Button
                                                                    type="text"
                                                                    size="small"
                                                                    aria-label="恢复到项目列表"
                                                                    icon={<RotateCcw className="size-4 text-emerald-600 dark:text-emerald-400" />}
                                                                    onClick={async () => {
                                                                        restoreProject(item.project!);
                                                                        // Restoring only changes the in-memory Zustand state. Flush
                                                                        // before closing/navigating so a local project cannot vanish
                                                                        // when the project library remounts immediately afterwards.
                                                                        await flushCanvasStorePersistence();
                                                                        removeDeletedItem(item.id);
                                                                    }}
                                                                />
                                                            </Tooltip>
                                                        ) : null}
                                                        <Tooltip title="从历史列表中移除此条记录">
                                                            <Button type="text" size="small" danger aria-label="从历史列表中移除此条记录" icon={<X className="size-4" />} onClick={() => removeDeletedItem(item.id)} />
                                                        </Tooltip>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            <footer className="libtv-recycle-footer"><span>已选择 {selectedDeleted.length} 项</span><Button disabled={!selectedDeleted.length} onClick={async () => { for (const id of selectedDeleted) { const item = deletedProjects.find((entry) => entry.id === id); if (localOnly && item?.project) restoreProject(item.project); removeDeletedItem(id); } await flushCanvasStorePersistence(); setSelectedDeleted([]); }}>恢复</Button></footer>
            </div>
        </Modal>
    );
}

function formatTimelineDate(isoString: string) {
    if (!isoString) return "--";
    const date = new Date(isoString);
    if (!Number.isFinite(date.getTime())) return "--";
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
