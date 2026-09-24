import { expect, test } from "bun:test";

import * as workspaceBootstrap from "../src/components/workspace/workspace-bootstrap-hydrator";
import { localWorkspaceConfig } from "../src/lib/user-session";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";
import { createModelConfigRepository } from "../src/services/model-config-repository";

test("local-mode startup restores the local model config after the session", async () => {
    const initialize = (workspaceBootstrap as Record<string, unknown>).initializeWorkspaceState as undefined | ((input: {
        loadWorkspace: () => Promise<{ source: string }>;
        createLocalWorkspace: () => { source: string };
        applySession: (payload: { source: string }) => Promise<void>;
        restoreModelConfig: () => Promise<void>;
    }) => Promise<void>);
    expect(typeof initialize).toBe("function");

    const state = { session: "", videoModels: [] as string[], restoreCalls: 0 };
    await initialize!({
        loadWorkspace: async () => { throw new Error("backend starting"); },
        createLocalWorkspace: () => ({ source: "local" }),
        applySession: async (payload) => {
            state.session = payload.source;
        },
        restoreModelConfig: async () => {
            state.restoreCalls += 1;
            state.videoModels = ["beefapi::seedance-2.0-fast"];
        },
    });

    expect(state).toEqual({ session: "local", videoModels: ["beefapi::seedance-2.0-fast"], restoreCalls: 1 });
});

test("local-mode startup still restores the canonical model config when browser session hydration fails", async () => {
    const initialize = (workspaceBootstrap as Record<string, unknown>).initializeWorkspaceState as undefined | ((input: {
        loadWorkspace: () => Promise<{ source: string }>;
        createLocalWorkspace: () => { source: string };
        applySession: (payload: { source: string }) => Promise<void>;
        restoreModelConfig: () => Promise<void>;
    }) => Promise<void>);
    expect(typeof initialize).toBe("function");

    let restoreCalls = 0;
    await expect(initialize!({
        loadWorkspace: async () => ({ source: "backend" }),
        createLocalWorkspace: () => ({ source: "local" }),
        applySession: async () => { throw new Error("corrupt browser snapshot"); },
        restoreModelConfig: async () => { restoreCalls += 1; },
    })).rejects.toThrow("corrupt browser snapshot");

    expect(restoreCalls).toBe(1);
});

test("model config autosave predicate remains independently testable", () => {
    const shouldSave = (workspaceBootstrap as Record<string, unknown>).shouldSaveLocalModelConfig as undefined | ((input: {
        subscriptionReady: boolean;
        modelConfigReady: boolean;
        channelCount: number;
    }) => boolean);
    expect(typeof shouldSave).toBe("function");
    expect(shouldSave!({ subscriptionReady: true, modelConfigReady: true, channelCount: 1 })).toBe(true);
});

test("migrated or recovered model config is durably written after hydration", () => {
    const shouldPersist = (workspaceBootstrap as Record<string, unknown>).shouldPersistHydratedModelConfig as undefined | ((health: string) => boolean);
    expect(typeof shouldPersist).toBe("function");
    expect(shouldPersist!("migrated")).toBe(true);
    expect(shouldPersist!("recovered")).toBe(true);
    expect(shouldPersist!("ready")).toBe(false);
    expect(shouldPersist!("default")).toBe(false);
});

test("local config strips hosted system channels but keeps direct user channels", () => {
    const config = localWorkspaceConfig({
        ...defaultConfig,
        channels: [
            createModelChannel({ id: "system", scope: "system", baseUrl: "/api/ai/system/platform", apiKey: "system", models: ["managed"] }),
            createModelChannel({ id: "direct", scope: "user", baseUrl: "https://example.test/v1", apiKey: "local-key", models: ["local-model"] }),
        ],
        model: "direct::local-model",
    });
    expect(config.channels.map((channel) => channel.id)).toEqual(["direct"]);
    expect(config.channels[0]?.apiKey).toBe("local-key");
});

test("local config disables legacy RunningHub settings and system catalog refresh", async () => {
    const config = localWorkspaceConfig({
        ...defaultConfig,
        runningHub: { ...defaultConfig.runningHub, enabled: true, apiKey: "legacy-cloud-key", workflowId: "workflow-1" },
    });
    expect(config.runningHub.enabled).toBe(false);
    expect(config.runningHub.apiKey).toBe("");
    expect(config.runningHub.workflowId).toBe("");
});

test("model config repository serializes rapid edits and persists the latest snapshot", async () => {
    const writes: string[] = [];
    let releaseFirstWrite: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const repository = createModelConfigRepository({
        read: async () => ({ config: defaultConfig, revision: 4, health: "ready", source: "builtin+local" }),
        write: async (config, expectedRevision) => {
            writes.push(`${expectedRevision}:${config.imageModel}`);
            if (writes.length === 1) await firstWrite;
            return { saved: true, revision: expectedRevision + 1 };
        },
    });
    await repository.hydrate();
    const first = repository.commit({ ...defaultConfig, imageModel: "first" });
    const second = repository.commit({ ...defaultConfig, imageModel: "latest" });
    releaseFirstWrite?.();
    await Promise.all([first, second]);

    expect(writes).toEqual(["4:first", "5:latest"]);
    expect(repository.getState()).toMatchObject({ status: "saved", revision: 6, dirty: false });
});

test("model config repository keeps failed edits dirty and retries them on flush", async () => {
    let attempts = 0;
    const repository = createModelConfigRepository({
        read: async () => ({ config: defaultConfig, revision: 1, health: "ready", source: "builtin+local" }),
        write: async (_config, expectedRevision) => {
            attempts += 1;
            if (attempts === 1) throw new Error("disk unavailable");
            return { saved: true, revision: expectedRevision + 1 };
        },
    });
    await repository.hydrate();
    await repository.commit({ ...defaultConfig, textModel: "beefapi::gpt-5.6-sol" });
    expect(repository.getState()).toMatchObject({ status: "error", dirty: true });
    await repository.flush();
    expect(attempts).toBe(2);
    expect(repository.getState()).toMatchObject({ status: "saved", dirty: false, revision: 2 });
});

test("model config repository refreshes revision after conflict and retries the local edit", async () => {
    const expectedRevisions: number[] = [];
    let reads = 0;
    const repository = createModelConfigRepository({
        read: async () => {
            reads += 1;
            return { config: defaultConfig, revision: reads === 1 ? 2 : 7, health: "ready", source: "builtin+local" };
        },
        write: async (_config, expectedRevision) => {
            expectedRevisions.push(expectedRevision);
            if (expectedRevision === 2) throw Object.assign(new Error("conflict"), { status: 409 });
            return { saved: true, revision: 8 };
        },
    });
    await repository.hydrate();
    await repository.commit({ ...defaultConfig, videoModel: "beefapi::seedance-new" });

    expect(expectedRevisions).toEqual([2, 7]);
    expect(repository.getState()).toMatchObject({ status: "saved", revision: 8, dirty: false });
});

test("model config repository reload replaces stale dirty edits with the server snapshot", async () => {
    const repository = createModelConfigRepository({
        read: async () => ({
            config: { ...defaultConfig, channels: [createModelChannel({ id: "beefapi", models: ["enterprise-image"], pinned: true })] },
            revision: 9,
            health: "ready",
            source: "builtin+local",
        }),
        write: async (_config, expectedRevision) => {
            return { saved: true, revision: expectedRevision + 1 };
        },
    });
    await repository.hydrate();
    const pending = repository.commit({ ...defaultConfig, channels: [createModelChannel({ id: "beefapi", models: [], pinned: true })] });
    const reloaded = await repository.reload();
    await pending;
    expect(reloaded.revision).toBe(9);
    expect(reloaded.config.channels[0]?.models).toEqual(["enterprise-image"]);
    expect(repository.getState()).toMatchObject({ dirty: false, revision: 9 });
});

test("model config repository does not save browser state before canonical hydration", async () => {
    let writes = 0;
    const repository = createModelConfigRepository({
        read: async () => ({ config: defaultConfig, revision: 0, health: "default", source: "builtin+local" }),
        write: async (_config, expectedRevision) => {
            writes += 1;
            return { saved: true, revision: expectedRevision + 1 };
        },
    });
    const pending = repository.commit({ ...defaultConfig, audioModel: "local-cache" });
    await Promise.resolve();
    expect(writes).toBe(0);
    await repository.hydrate();
    await pending;
    expect(writes).toBe(1);
});
