import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createDefaultTracks, normalizeTimelineProject } from "@/lib/timeline/timeline-tracks";
import type { TimelineProject } from "@/types/timeline";

const dir = mkdtempSync(join(import.meta.dir, ".timeline-persist-http-"));
const repositorySource = readFileSync(new URL("../src/services/local-workspace-repository.ts", import.meta.url), "utf8");
const storePath = join(dir, "store.ts");
const historyPath = join(dir, "history.ts");
const requestPath = join(dir, "request.ts");
const assetsPath = join(dir, "assets.ts");
const resourcesPath = join(dir, "resources.ts");
const modePath = join(dir, "mode.ts");

writeFileSync(storePath, `
export type CanvasProject = any;
export let projects: any[] = [];
export const resetProjects = (next: any[]) => { projects = next; };
const getState = () => ({
  projects,
  openProject: (id: string) => projects.find((project) => project.id === id) ?? null,
  updateProject: (id: string, patch: Record<string, unknown>) => {
    projects = projects.map((project) => project.id === id ? { ...project, ...patch } : project);
  },
});
export const useCanvasStore = { getState, setState: () => {} };
export const flushCanvasStorePersistence = async () => {};
`);
writeFileSync(historyPath, "export const useCanvasHistoryStore = { getState: () => ({ recordDeletedProjects: () => {} }) };\n");
writeFileSync(requestPath, `
export let puts: Array<{ path: string; body: any }> = [];
export let putError: Error | null = null;
export const resetPuts = () => { puts = []; putError = null; };
export const setPutError = (next: Error | null) => { putError = next; };
export const http = {
  put: async (path: string, body: any) => {
    if (putError) throw putError;
    puts.push({ path, body });
    return { project: { id: body.project.id, title: body.project.title, createdAt: body.project.createdAt, updatedAt: body.project.updatedAt, revision: (body.project.revision ?? 0) + 1 } };
  },
};
`);
writeFileSync(assetsPath, "export const useAssetStore = { getState: () => ({ assets: [] }) };\n");
writeFileSync(resourcesPath, 'export const resourceIdFromStorageKey = () => "";\n');
writeFileSync(modePath, "export let localMode = true; export const setLocalMode = (next: boolean) => { localMode = next; }; export const isLocalWorkspaceMode = () => localMode;\n");
writeFileSync(join(dir, "repository.ts"), repositorySource
    .replace('"@/stores/canvas/use-canvas-store"', JSON.stringify(pathToFileURL(storePath).href))
    .replace('"@/stores/canvas/use-canvas-history-store"', JSON.stringify(pathToFileURL(historyPath).href))
    .replace('"@/services/api/request"', JSON.stringify(pathToFileURL(requestPath).href))
    .replace('"@/services/api/resources"', JSON.stringify(pathToFileURL(resourcesPath).href))
    .replace('"@/stores/use-asset-store"', JSON.stringify(pathToFileURL(assetsPath).href))
    .replace('"@/services/workspace-mode"', JSON.stringify(pathToFileURL(modePath).href)));

const repository: typeof import("../src/services/local-workspace-repository") = await import(join(dir, "repository.ts"));
const store = await import(storePath);
const request = await import(requestPath);
const mode = await import(modePath);

const timeline: TimelineProject = normalizeTimelineProject({
    version: 2,
    tracks: createDefaultTracks(),
    durationMs: 5600,
    clips: [{
        id: "clip-audio-1",
        kind: "audio",
        nodeId: "7vvfM674HnenwTekmj88V",
        trackId: "audio-1",
        startMs: 0,
        durationMs: 5600,
        title: "旁白",
    }],
});

const project = {
    id: "canvas-a",
    title: "验收画布",
    createdAt: "2026-09-24T08:00:00.000Z",
    updatedAt: "2026-09-24T08:00:00.000Z",
    revision: 0,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "grid",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    directorScenes: [],
};

beforeEach(() => {
    store.resetProjects([{ ...project }]);
    request.resetPuts();
    mode.setLocalMode(true);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("persistCanvasTimeline http", () => {
    it("PUTs the timeline document to the desktop canvas route", async () => {
        await repository.persistCanvasTimeline(project.id, timeline);
        expect(request.puts).toHaveLength(1);
        expect(request.puts[0].path).toBe("/canvas-projects/canvas-a");
        expect(request.puts[0].body.project.timeline.durationMs).toBe(5600);
        expect(request.puts[0].body.project.timeline.clips).toEqual([
            expect.objectContaining({ id: "clip-audio-1", kind: "audio", nodeId: "7vvfM674HnenwTekmj88V", durationMs: 5600 }),
        ]);
        expect(request.puts[0].body.project.timeline.tracks.map((track: { kind: string }) => track.kind)).toEqual(["video", "audio", "subtitle"]);
    });

    it("does not PUT on the hosted profile", async () => {
        mode.setLocalMode(false);
        await repository.persistCanvasTimeline(project.id, timeline);
        expect(request.puts).toEqual([]);
        expect(store.projects[0].timeline.durationMs).toBe(5600);
    });

    it("rejects when the desktop PUT fails", async () => {
        request.setPutError(new Error("画布后端持久化失败"));
        let caught: unknown;
        try {
            await repository.persistCanvasTimeline(project.id, timeline);
        } catch (error) {
            caught = error;
        }
        expect((caught as Error).message).toBe("画布后端持久化失败");
        expect(request.puts).toEqual([]);
    });
});
