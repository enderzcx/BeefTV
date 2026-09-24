import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type Project = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision?: number;
    nodes: Array<{ id: string }>;
    connections: unknown[];
    chatSessions: unknown[];
    activeChatId: null;
    backgroundMode: "grid";
    showImageInfo: boolean;
    viewport: { x: number; y: number; k: number };
    directorScenes: unknown[];
};

const dir = mkdtempSync(join(import.meta.dir, ".local-workspace-stale-"));
const repositorySource = readFileSync(new URL("../src/services/local-workspace-repository.ts", import.meta.url), "utf8");
const storePath = join(dir, "store.ts");
const historyPath = join(dir, "history.ts");
const requestPath = join(dir, "request.ts");

writeFileSync(storePath, `
export type CanvasProject = any;
export let projects: any[] = [];
export const resetProjects = (next: any[]) => { projects = next; };
const getState = () => ({
  projects,
  openProject: (id: string) => projects.find((project) => project.id === id) ?? null,
  createProject: () => "unused",
  updateProject: () => {},
  deleteProjects: () => {},
});
export const useCanvasStore = {
  getState,
  setState: (update: any) => {
    const patch = typeof update === "function" ? update(getState()) : update;
    if (patch.projects) projects = patch.projects;
  },
};
export const flushCanvasStorePersistence = async () => {};
`);
writeFileSync(historyPath, "export const useCanvasHistoryStore = { getState: () => ({ recordDeletedProjects: () => {} }) };\n");
writeFileSync(requestPath, `
export let remoteProject: any;
export let remoteProjects: any[] = [];
export const setRemoteProject = (next: any) => { remoteProject = next; remoteProjects = next ? [{ id: next.id }] : []; };
export const http = { get: async (path: string) => path === "/canvas-projects" ? { projects: remoteProjects } : { project: remoteProject } };
`);
writeFileSync(join(dir, "repository.ts"), repositorySource
    .replace('"@/stores/canvas/use-canvas-store"', JSON.stringify(pathToFileURL(storePath).href))
    .replace('"@/stores/canvas/use-canvas-history-store"', JSON.stringify(pathToFileURL(historyPath).href))
    .replace('"@/services/api/request"', JSON.stringify(pathToFileURL(requestPath).href)));

const repository: typeof import("../src/services/local-workspace-repository") = await import(join(dir, "repository.ts"));
const store = await import(storePath);
const request = await import(requestPath);

const project = (overrides: Partial<Project> = {}): Project => ({
    id: "canvas-a",
    title: "画布 A",
    createdAt: "2026-09-22T08:00:00.000Z",
    updatedAt: "2026-09-22T08:00:00.000Z",
    revision: 0,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "grid",
    showImageInfo: true,
    viewport: { x: 0, y: 0, k: 1 },
    directorScenes: [],
    ...overrides,
});

beforeEach(() => {
    store.resetProjects([]);
    request.setRemoteProject(undefined);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("local workspace stale backend protection", () => {
    it("keeps newer local canvas content when opening an older backend snapshot", async () => {
        const local = project({ updatedAt: "2026-09-22T09:00:00.000Z", nodes: [{ id: "kept-node" }] });
        const staleRemote = project({ updatedAt: "2026-09-22T08:00:00.000Z", nodes: [] });
        store.resetProjects([local]);
        request.setRemoteProject(staleRemote);

        expect(await repository.openLocalCanvasProjectFromBackend(local.id)).toEqual(local);
        expect(store.projects[0].nodes).toEqual([{ id: "kept-node" }]);
    });

    it("keeps newer local canvas content during backend hydration", async () => {
        const local = project({ updatedAt: "2026-09-22T09:00:00.000Z", nodes: [{ id: "kept-node" }] });
        const staleRemote = project({ updatedAt: "2026-09-22T08:00:00.000Z", nodes: [] });
        store.resetProjects([local]);
        request.setRemoteProject(staleRemote);

        await repository.hydrateLocalCanvasProjectsFromBackend();
        expect(store.projects[0].nodes).toEqual([{ id: "kept-node" }]);
    });

    it("accepts a genuinely newer backend snapshot", async () => {
        const local = project({ updatedAt: "2026-09-22T08:00:00.000Z", nodes: [] });
        const remote = project({ updatedAt: "2026-09-22T09:00:00.000Z", revision: 1, nodes: [{ id: "remote-node" }] });
        store.resetProjects([local]);
        request.setRemoteProject(remote);

        expect(await repository.openLocalCanvasProjectFromBackend(local.id)).toEqual(remote);
        expect(store.projects[0].nodes).toEqual([{ id: "remote-node" }]);
    });
});
