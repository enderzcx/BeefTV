export type CanvasWorkspaceProjectRecord = {
    id: string;
    createdAt: string;
    updatedAt: string;
    workspaceProjectId?: string;
};

/**
 * Legacy canvas documents predate project grouping. Treating a missing owner
 * as the canvas itself prevents unrelated historical canvases from collapsing
 * into one project during hydration.
 */
export function canvasWorkspaceProjectId(canvas: Pick<CanvasWorkspaceProjectRecord, "id" | "workspaceProjectId">) {
    return canvas.workspaceProjectId?.trim() || canvas.id;
}

export function listCanvasWorkspaceProjectCanvases<T extends CanvasWorkspaceProjectRecord>(canvases: readonly T[], currentCanvasId: string): T[] {
    const current = canvases.find((canvas) => canvas.id === currentCanvasId);
    if (!current) return [];
    const workspaceProjectId = canvasWorkspaceProjectId(current);
    return canvases
        .filter((canvas) => canvasWorkspaceProjectId(canvas) === workspaceProjectId)
        .slice()
        .sort((left, right) => {
            if (left.id === workspaceProjectId) return -1;
            if (right.id === workspaceProjectId) return 1;
            return compareCanvasCreationOrder(left, right);
        });
}

export function listCanvasWorkspaceProjectRoots<T extends CanvasWorkspaceProjectRecord>(canvases: readonly T[]): T[] {
    const groups = new Map<string, T[]>();
    for (const canvas of canvases) {
        const workspaceProjectId = canvasWorkspaceProjectId(canvas);
        const group = groups.get(workspaceProjectId);
        if (group) group.push(canvas);
        else groups.set(workspaceProjectId, [canvas]);
    }
    return [...groups.entries()].map(([workspaceProjectId, group]) =>
        group.find((canvas) => canvas.id === workspaceProjectId)
        || group.slice().sort(compareCanvasCreationOrder)[0],
    );
}

export function canvasIdsForWorkspaceProjects<T extends CanvasWorkspaceProjectRecord>(canvases: readonly T[], selectedCanvasIds: readonly string[]): string[] {
    const selectedWorkspaceProjectIds = new Set(selectedCanvasIds.flatMap((id) => {
        const canvas = canvases.find((item) => item.id === id);
        return canvas ? [canvasWorkspaceProjectId(canvas)] : [];
    }));
    return canvases
        .filter((canvas) => selectedWorkspaceProjectIds.has(canvasWorkspaceProjectId(canvas)))
        .slice()
        .sort(compareCanvasCreationOrder)
        .map((canvas) => canvas.id);
}

function compareCanvasCreationOrder(left: CanvasWorkspaceProjectRecord, right: CanvasWorkspaceProjectRecord) {
    const created = left.createdAt.localeCompare(right.createdAt);
    return created || left.id.localeCompare(right.id);
}
