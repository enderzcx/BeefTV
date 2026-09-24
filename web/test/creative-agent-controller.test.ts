import { describe, expect, test } from "bun:test";
import { CreativeAgentController, type CreativeControllerView } from "../src/services/creative-agent-controller";
import { initialCreativeState, type CreativeAgentState } from "../src/lib/creation/creative-agent-state";
import { creationRuns, type CreationRun, type CreationSubmission } from "../src/services/api/creation-runs";
import { applyCanvasOperations, type CanvasSnapshot } from "../src/lib/canvas/canvas-operation-contract";
import { defaultConfig } from "../src/stores/use-config-store";
import type { GenerationTask } from "../src/services/api/task-center";
import { CanvasNodeType } from "../src/types/canvas";
import { CREATIVE_AGENT_SYSTEM_PROMPT, CREATIVE_AGENT_TOOLS } from "../src/lib/creation/creative-agent-tools";

test("首页创造规划请求使用自动工具选择", async () => {
    const source = await Bun.file(new URL("../src/services/creative-agent-controller.ts", import.meta.url)).text();
    expect(source).toContain('tools: CREATIVE_AGENT_TOOLS, toolChoice: "auto"');
    expect(source).not.toContain('tools: CREATIVE_AGENT_TOOLS, toolChoice: "required"');
});

test("首页创造提示词只声明实际注册的规划工具", () => {
    expect(CREATIVE_AGENT_TOOLS.map((tool) => tool.function.name)).toEqual(["creative_respond"]);
    expect(CREATIVE_AGENT_SYSTEM_PROMPT).toContain("唯一可调用的函数工具是 creative_respond");
    expect(CREATIVE_AGENT_SYSTEM_PROMPT).not.toContain("canvas_generate_storyboard");
    expect(CREATIVE_AGENT_SYSTEM_PROMPT).not.toContain("canvas_create_storyboard");
    expect(CREATIVE_AGENT_SYSTEM_PROMPT).not.toContain("canvas_edit_storyboard");
});

function harness(state: CreativeAgentState, status: CreationRun["status"] = "paused", submissions: CreationSubmission[] = [], waitTask?: ConstructorParameters<typeof CreativeAgentController>[0]["waitTask"], localRuntime = false, config = defaultConfig) {
    let run: CreationRun = { id: "run", userId: "user", canvasId: "canvas", revision: 1, executionEpoch: 0, executionOwner: "", status, state: structuredClone(state) as unknown as Record<string, unknown>, approvedProposalVersion: state.proposal?.version, approvedProposalHash: state.operations ? "approved-proposal-hash" : undefined, createdAt: "", updatedAt: "" };
    let snapshot: CanvasSnapshot = { projectId: "canvas", title: "canvas", nodes: state.media.map((media) => ({ id: media.nodeId, type: CanvasNodeType.Image, title: media.ref, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} })), connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    let view: CreativeControllerView | undefined;
    let commits = 0, prepares = 0, executions = 0;
    const api = { ...creationRuns,
        get: async () => ({ run: structuredClone(run), submissions: structuredClone(submissions) }),
        claim: async (_id: string, input: { owner: string }) => (run = { ...run, executionEpoch: run.executionEpoch + 1, executionOwner: input.owner }),
        save: async (_id: string, input: { revision: number; status: CreationRun["status"]; state: Record<string, unknown> }) => { if (input.revision !== run.revision) throw new Error("stale"); return run = { ...run, revision: run.revision + 1, state: structuredClone(input.state), status: input.status }; },
        release: async () => ({ released: true }),
        prepare: async () => { prepares++; throw new Error("不应准备新任务"); },
        approve: async (_id: string, input: { submissionIds: string[] }) => ({ submissions: input.submissionIds.map((id) => ({ ...submission(id, "planning:key"), approvedAt: "2026-01-01" })) }),
        execute: async () => { executions++; throw new Error("不应执行新任务"); },
        canvas: async () => ({ run, canvasId: "canvas" }),
        canvasSnapshot: async () => ({ document: { id: "canvas", title: "canvas", nodes: snapshot.nodes, connections: snapshot.connections, chatSessions: [], activeChatId: null, viewport: snapshot.viewport, createdAt: "", updatedAt: "", directorScenes: [] }, snapshotHash: "hash" }),
        commitCanvas: async () => { commits++; return { snapshotHash: "saved" }; },
    } as typeof creationRuns;
    const controller = new CreativeAgentController({ localRuntime, config: () => config, canvas: () => ({ canvasId: "canvas", read: () => snapshot, apply: async (ops) => snapshot = applyCanvasOperations(snapshot, ops) }), onChange: (next) => { view = next; }, onOpenCanvas: () => undefined, api, waitTask, ensureAsset: async () => ({ assetId: "asset", created: false, linkedToProject: false }) });
    return { controller, api, view: () => view!, counters: () => ({ commits, prepares, executions }), snapshot: () => snapshot };
}
const proposal = { id: "p", version: 1, title: "方案", summary: "摘要", markdown: "内容", deliverables: [], workflow: { nodes: [], edges: [], autoRun: false as const }, generationItems: [] };
const submission = (id: string, itemKey: string, taskId?: string): CreationSubmission => ({ id, runId: "run", itemKey, requestHash: "hash", taskId, execution: { model: "model", configHash: "execution" } });

test("本地运行时自动准入规划，不进入 waiting_execution", async () => {
    const quote = submission("plan", "planning:key");
    const completed = { id: "task", status: "succeeded", resultJson: JSON.stringify({ toolCalls: [{ id: "first", type: "function", function: { name: "creative_respond", arguments: JSON.stringify({ message: "完成" }) } }] }) } as GenerationTask;
    const h = harness({ ...initialCreativeState(), planning: { itemKey: "planning:key", protocol: [], model: "model" } }, "running", [quote], async () => completed, true);
    try {
        h.api.execute = async () => completed;
        await h.controller.load("run");
        await h.controller.resume();
        expect(h.view().quote).toBeUndefined();
        expect(h.view().run?.status).not.toBe("waiting_execution");
    } finally { h.controller.dispose(); }
});

test("本地运行时恢复未批准规划提交时自动准入", async () => {
    const quote = submission("plan", "planning:key");
    const completed = { id: "task", status: "succeeded", resultJson: JSON.stringify({ toolCalls: [{ id: "first", type: "function", function: { name: "creative_respond", arguments: JSON.stringify({ message: "恢复完成" }) } }] }) } as GenerationTask;
    const h = harness({ ...initialCreativeState(), planning: { itemKey: "planning:key", submissionId: "plan", protocol: [] }, pendingExecution: ["plan"] }, "waiting_execution", [quote], async () => completed, true);
    h.api.execute = async () => completed;
    try {
        await h.controller.load("run");
        await h.controller.resume();
        expect(h.view().quote).toBeUndefined();
        expect(h.view().state.pendingExecution).toBeUndefined();
        expect(h.view().run?.status).not.toBe("waiting_execution");
    } finally { h.controller.dispose(); }
});

test("本地运行时批量媒体自动准入并执行，不进入 waiting_execution", async () => {
    const localProposal = { ...proposal, generationItems: [{ ref: "shot", mode: "image" as const, model: "managed::managed-image" }] };
    const completed = { id: "task-shot", status: "succeeded", resultJson: JSON.stringify({ images: [{ storageKey: "resource:output", dataUrl: "/api/resources/output/file" }] }) } as GenerationTask;
    const config = { ...defaultConfig, model: "managed::managed-image", channels: [{ id: "managed", name: "本地测试模型", baseUrl: "http://127.0.0.1", apiKey: "", apiFormat: "openai" as const, models: ["managed-image"], modelProfiles: [{ model: "managed-image", capability: "image" as const, logicalModelId: "logical-image", billingMode: "fixed_request" as const, unitPriceMicrocredits: 0 }] }] };
    const h = harness({ ...initialCreativeState(), proposal: localProposal, canvasApplied: true, media: [{ ref: "shot", nodeId: "shot", attempt: 1, status: "pending" }] }, "running", [], async () => completed, true, config);
    h.api.prepare = async () => submission("media", "media:v1:shot:1");
    h.api.approve = async (_id, input) => ({ submissions: input.submissionIds.map((id) => ({ ...submission(id, "media:v1:shot:1"), approvedAt: "2026-01-01" })) });
    h.api.execute = async () => completed;
    try {
        await h.controller.load("run");
        await h.controller.resume();
        expect(h.view().quote).toBeUndefined();
        expect(h.view().state.pendingExecution).toBeUndefined();
        expect(h.view().state.media[0].status).toBe("ready");
        expect(h.view().run?.status).toBe("completed");
    } finally { h.controller.dispose(); }
});

describe("创作控制器恢复", () => {
    for (const terminal of [true, false]) test(terminal ? "任务已失败时标记生成失败，不能引导反复读取" : "仅查询断线时保留结果恢复语义，不当作需要重做", async () => {
        const h = harness({ ...initialCreativeState(), proposal, canvasApplied: true, media: [{ ref: "a", nodeId: "a", attempt: 1, submissionId: "a", taskId: "a", status: "queued" }] }, "waiting_task", [submission("a", "a", "a")], async (_id, options) => {
            if (terminal) options?.onTaskUpdate?.({ id: "a", status: "failed" } as GenerationTask);
            throw new Error("网络异常。");
        });
        try { await h.controller.load("run"); await expect(h.controller.resume()).rejects.toThrow(); expect(h.view().state.media[0].failureKind).toBe(terminal ? "generation" : "observation"); expect(h.counters().executions).toBe(0); }
        finally { h.controller.dispose(); }
    });
    test("刷新页面可接续仍有效的旧连接，不等待旧页面租约过期", async () => {
        const h = harness(initialCreativeState());
        const get = h.api.get, claim = h.api.claim;
        let foreign = true, claims = 0;
        h.api.get = async (...args) => { const detail = await get(...args); return foreign ? { ...detail, run: { ...detail.run, executionOwner: "previous-page", leaseExpiresAt: "2099-01-01" } } : detail; };
        h.api.claim = async (...args) => { claims++; foreign = false; return claim(...args); };
        try { await h.controller.load("run"); expect(h.view().hasControl).toBe(true); expect(claims).toBe(1); expect(h.counters().executions).toBe(0); }
        finally { h.controller.dispose(); }
    });
    test("普通恢复不争抢其他连接，用户重试连接可以显式接续", async () => {
        const h = harness(initialCreativeState());
        const get = h.api.get, claim = h.api.claim;
        let foreign = false, claims = 0;
        h.api.get = async (...args) => { const detail = await get(...args); return foreign ? { ...detail, run: { ...detail.run, executionOwner: "other-page", leaseExpiresAt: "2099-01-01" } } : detail; };
        h.api.claim = async (...args) => { claims++; foreign = false; return claim(...args); };
        try {
            await h.controller.load("run"); foreign = true;
            await expect(h.controller.refresh()).rejects.toThrow("重试连接"); expect(claims).toBe(1);
            await h.controller.takeControl(); expect(claims).toBe(2); expect(h.view().hasControl).toBe(true); expect(h.view().error).toBeUndefined();
        } finally { h.controller.dispose(); }
    });
    test("已提交的本地任务恢复时不重复准入", async () => {
        const old = { ...submission("a", "a", "task-a"), approvedAt: "2026-01-01" };
        const completed = { id: "task-a", status: "succeeded", resultJson: JSON.stringify({ images: [{ storageKey: "resource:output" }] }) } as GenerationTask;
        const h = harness({ ...initialCreativeState(), proposal, canvasApplied: true, pendingExecution: ["a"], media: [{ ref: "a", nodeId: "a", attempt: 1, submissionId: "a", taskId: "task-a", status: "queued" }] }, "waiting_task", [old], async () => completed);
        h.api.approve = async () => { throw new Error("不应重新批准已提交任务"); };
        h.api.execute = async (_id, input) => { expect(input.submissionId).toBe("a"); return completed; };
        try { await h.controller.load("run"); await h.controller.resume(); expect(h.view().state.media[0].status).toBe("ready"); expect(h.counters().prepares).toBe(0); }
        finally { h.controller.dispose(); }
    });
    test("未准入的本地规划任务自动准入并只展示首个问答", async () => {
        const prepared = submission("plan", "planning:key");
        const completed = { id: "task", status: "succeeded", resultJson: JSON.stringify({ toolCalls: [
            { id: "first", type: "function", function: { name: "creative_respond", arguments: JSON.stringify({ message: "请补充目标", questions: [{ field: "goal", title: "想做什么？", type: "text", required: true, allowCustom: true }] }) } },
            { id: "second", type: "function", function: { name: "creative_respond", arguments: JSON.stringify({ proposal: { title: "不应执行" } }) } },
        ] }) } as GenerationTask;
        const h = harness({ ...initialCreativeState(), planning: { itemKey: "planning:key", submissionId: "plan", protocol: [] }, pendingExecution: ["plan"] }, "waiting_execution", [prepared], async () => completed);
        let approved = false, executed = 0;
        h.api.approve = async () => { approved = true; return { submissions: [{ ...prepared, approvedAt: "2026-01-01" }] }; };
        h.api.execute = async () => { expect(approved).toBe(true); executed++; return completed; };
        try {
            await h.controller.load("run"); await h.controller.resume();
            expect(executed).toBe(1); expect(h.view().run?.status).toBe("waiting_answer");
            expect(h.view().state.questions?.questions).toHaveLength(1);
            expect(h.view().state.proposal).toBeUndefined(); expect(h.counters().commits).toBe(0);
        } finally { h.controller.dispose(); }
    });
    test("暂停于已批准画布接续时仍可创建节点并完成，不提交模型任务", async () => {
        const h = harness({ ...initialCreativeState(), proposal, operations: [{ type: "add_node", id: "outline", nodeType: CanvasNodeType.Text, title: "大纲", metadata: { content: "内容" } }], canvasApplied: false });
        try { await h.controller.load("run"); await h.controller.resume(); expect(h.snapshot().nodes).toHaveLength(1); expect(h.view().run?.status).toBe("completed"); expect(h.counters()).toEqual({ commits: 1, prepares: 0, executions: 0 }); } finally { h.controller.dispose(); }
    });
    test("未批准的方案恢复时仍等待用户确认，不创建画布节点", async () => {
        const h = harness({ ...initialCreativeState(), proposal, canvasApplied: false });
        try { await h.controller.load("run"); await h.controller.resume(); expect(h.view().run?.status).toBe("waiting_proposal"); expect(h.snapshot().nodes).toHaveLength(0); expect(h.counters()).toEqual({ commits: 0, prepares: 0, executions: 0 }); }
        finally { h.controller.dispose(); }
    });
    test("第一项失败不阻止同批成功结果回写", async () => {
        const media = ["a", "b"].map((ref) => ({ ref, nodeId: ref, attempt: 1, submissionId: ref, taskId: ref, status: "queued" as const }));
        const h = harness({ ...initialCreativeState(), proposal, canvasApplied: true, media }, "paused", [submission("a", "a", "a"), submission("b", "b", "b")], async (id) => { if (id === "a") throw new Error("A生成失败"); return { id, status: "succeeded", resultJson: JSON.stringify({ images: [{ storageKey: "resource:output", dataUrl: "/api/resources/output/file" }] }) } as GenerationTask; });
        try { await h.controller.load("run"); await expect(h.controller.resume()).rejects.toThrow("A生成失败"); expect(h.view().state.media.map((item) => item.status)).toEqual(["failed", "ready"]); expect(h.counters().executions).toBe(0); expect(h.counters().commits).toBe(1); } finally { h.controller.dispose(); }
    });
    test("暂停后迟到的任务回调不能写画布", async () => {
        let resolveTask!: (task: GenerationTask) => void;
        let waiting!: () => void; const started = new Promise<void>((resolve) => { waiting = resolve; });
        const h = harness({ ...initialCreativeState(), proposal, canvasApplied: true, media: [{ ref: "a", nodeId: "a", attempt: 1, submissionId: "a", taskId: "a", status: "queued" }] }, "waiting_task", [submission("a", "a", "a")], () => { waiting(); return new Promise((resolve) => { resolveTask = resolve; }); });
        try {
            await h.controller.load("run"); const resume = h.controller.resume(); await started; await h.controller.pause();
            resolveTask({ id: "a", status: "succeeded", resultJson: JSON.stringify({ images: [{ storageKey: "resource:a" }] }) } as GenerationTask);
            await expect(resume).rejects.toThrow(); expect(h.counters().commits).toBe(0); expect(h.view().hasControl).toBe(false);
        } finally { h.controller.dispose(); }
    });
});
