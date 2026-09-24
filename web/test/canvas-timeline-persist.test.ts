import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { createDefaultTracks, normalizeTimelineProject } from "@/lib/timeline/timeline-tracks";
import { useCanvasStore, withCanvasStorePersistenceSuppressed } from "@/stores/canvas/use-canvas-store";
import type { TimelineProject } from "@/types/timeline";

function sampleTimeline(): TimelineProject {
    return normalizeTimelineProject({
        version: 2,
        tracks: createDefaultTracks(),
        durationMs: 5600,
        clips: [
            {
                id: "clip-audio-1",
                kind: "audio",
                nodeId: "7vvfM674HnenwTekmj88V",
                trackId: "audio-1",
                startMs: 0,
                durationMs: 5600,
                title: "旁白",
                sourceStartMs: 0,
                sourceDurationMs: 5600,
            },
        ],
    });
}

function reloadedTimeline(project: unknown): TimelineProject {
    const payload = JSON.parse(JSON.stringify(project)) as { timeline?: TimelineProject };
    expect(payload.timeline).toBeDefined();
    return payload.timeline!;
}

describe("canvas timeline persistence", () => {
    test("saved timeline clips, tracks and duration survive JSON save/load", () => {
        const previous = useCanvasStore.getState().projects;
        try {
            withCanvasStorePersistenceSuppressed(() => {
                useCanvasStore.setState({ projects: [] });
                const id = useCanvasStore.getState().createProject("验收画布");
                const timeline = sampleTimeline();
                useCanvasStore.getState().updateProject(id, { timeline });
                const stored = useCanvasStore.getState().openProject(id);
                const loaded = reloadedTimeline(stored);
                expect(loaded.durationMs).toBe(5600);
                expect(loaded.clips).toHaveLength(1);
                expect(loaded.clips[0]).toMatchObject({
                    id: "clip-audio-1",
                    kind: "audio",
                    nodeId: "7vvfM674HnenwTekmj88V",
                    trackId: "audio-1",
                    startMs: 0,
                    durationMs: 5600,
                });
                expect(loaded.tracks.map((track) => track.kind)).toEqual(["video", "audio", "subtitle"]);
            });
        } finally {
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previous }));
        }
    });

    test("later node-only persist does not drop the saved timeline document", () => {
        const previous = useCanvasStore.getState().projects;
        try {
            withCanvasStorePersistenceSuppressed(() => {
                useCanvasStore.setState({ projects: [] });
                const id = useCanvasStore.getState().createProject("验收画布");
                useCanvasStore.getState().updateProject(id, { timeline: sampleTimeline() });
                useCanvasStore.getState().updateProject(id, {
                    nodes: [{ id: "7vvfM674HnenwTekmj88V", type: "audio", title: "旁白", position: { x: 0, y: 0 }, width: 320, height: 120, metadata: { durationMs: 5600 } }] as never,
                });
                const loaded = reloadedTimeline(useCanvasStore.getState().openProject(id));
                expect(loaded.durationMs).toBe(5600);
                expect(loaded.clips[0]?.nodeId).toBe("7vvfM674HnenwTekmj88V");
                expect(loaded.tracks).toHaveLength(3);
            });
        } finally {
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previous }));
        }
    });

    test("timeline save writes the canvas document to the desktop repository", () => {
        const repository = readFileSync(new URL("../src/services/local-workspace-repository.ts", import.meta.url), "utf8");
        const page = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        expect(repository).toContain("await syncLocalCanvasProjectToBackend(id)");
        expect(repository).toContain("export async function persistCanvasTimeline");
        expect(page).toContain("onSave={(next) => persistCanvasTimeline(projectId, next)}");
        expect(page).not.toContain("onSave={(next) => updateProject(projectId, { timeline: next })}");
    });

    test("timeline dialog subtitle does not expose an implementation phase", () => {
        const source = readFileSync(new URL("../src/components/canvas/canvas-timeline-dialog.tsx", import.meta.url), "utf8");
        expect(source).toContain("轨道编辑与素材编排");
        expect(source).not.toContain("第二期 ·");
    });
});
