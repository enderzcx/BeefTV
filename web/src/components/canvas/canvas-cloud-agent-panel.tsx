import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Button, Dropdown, Input } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, ChevronRight, CircleDot, Clock3, History, LoaderCircle, MessageSquarePlus, Minus, Puzzle, Settings2, Share2, ShieldCheck, Trash2, Sparkles } from "lucide-react";
import { agentPlanVisible, latestAgentPlanItems, pendingAgentQuestion } from "@/lib/canvas/cloud-agent-plan";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/components/model-picker";
import { cn } from "@/lib/utils";
import { markdownPlainText } from "@/lib/markdown-plain-text";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { agentErrorPresentation, agentSubmissionErrorTitle } from "@/lib/canvas/agent-error-presentation";
import { cancelAgentRun, getAgentCapabilities, getAgentProfile, getAgentRun, createAgentRun, decideAgentApproval, sendAgentInterjection, sendAgentMessage, subscribeAgentEvents, updateAgentProfile, type AgentEvent, type AgentPermissionMode, type AgentProfileScope, type AgentProfileView, type AgentReasoningMode, type AgentRun, type CreateAgentRunInput } from "@/services/api/agent";
import { agentApprovalPresentation } from "@/lib/canvas/agent-approval-presentation";
import { agentApprovalMatchesSettings, agentImageApproval } from "@/lib/canvas/agent-media-approval";
import type { AgentMediaSettings } from "@/services/api/agent";
import { CanvasAgentImageApprovalSettings } from "./canvas-agent-image-approval-settings";
import { addSkill, listAddedSkills, listSkills, type Skill, type SkillCategory } from "@/services/api/skills";
import { clearCloudAgentPendingSubmission, cloudAgentConversationTitle, loadCloudAgentConversations, loadCloudAgentPendingSubmission, saveCloudAgentConversations, saveCloudAgentPendingSubmission, type CloudAgentConversation, type CloudAgentPendingSubmission } from "@/services/cloud-agent-conversations";
import { logicalModelIDForConfig, modelOptionName, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { applyAgentCanvasPatches, hasRemoteUserDataSyncSession, refreshCanvasAfterAgent, saveRemoteUserDataNow, syncLocalCanvasForAgent } from "@/services/local-workspace-sync";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { createAgentCanvasSync } from "@/services/agent-canvas-sync";
import { buildSkillMentionReferences, resolveSkillMentions } from "@/services/skill-runtime";
import { AgentChatComposer, AgentChatMessage, AgentPlanBar, AgentQuestionBar, AgentWorkingMessage, type CloudAgentChatMessage, type CloudAgentPlanItem } from "./canvas-cloud-agent-chat-ui";
import { CanvasAgentSkillLibraryModal } from "./canvas-agent-skill-library-modal";
import { CanvasCloudAgentSettings, agentPermissionLabel, agentPermissionMenuItems, agentPermissionVisual, type AgentContextKey } from "./canvas-cloud-agent-settings";
import { useAgentPanelLayout } from "./use-agent-panel-layout";
import "./canvas-cloud-agent.css";

type CloudAgentPanelProps = { canvasId: string; domainProjectId?: string; nodeCount: number; references: CanvasResourceReference[]; open: boolean; prefillPrompt?: string; onOpen: () => void; onCollapse: () => void; onFocusNode?: (nodeId: string) => void; onOpenPluginCenter?: () => void };
type ApprovalState = { approvalId: string; detail: Record<string, unknown>; reason: string };
type AgentPanelView = "chat" | "history" | "settings";

const LOCAL_AGENT_PROFILE_KEY = "canvas:agent-profiles";

function readLocalAgentProfiles(): Record<string, AgentProfileView> {
    try {
        const parsed = JSON.parse(localStorage.getItem(LOCAL_AGENT_PROFILE_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed as Record<string, AgentProfileView> : {};
    } catch {
        return {};
    }
}

function writeLocalAgentProfiles(profiles: Record<string, AgentProfileView>) {
    try {
        localStorage.setItem(LOCAL_AGENT_PROFILE_KEY, JSON.stringify(profiles));
    } catch {
        // If browser storage is unavailable, the current in-memory profile remains usable.
    }
}

function localAgentProfileKey(canvasId: string, projectId?: string) {
    return `${projectId || ""}:${canvasId}`;
}

function readLocalAgentProfile(canvasId: string, projectId?: string): AgentProfileView {
    return readLocalAgentProfiles()[localAgentProfileKey(canvasId, projectId)] || {
        revision: "local-0",
        hash: "local",
        layers: [{ scope: "canvas", canvasId, content: "", revision: 0, hash: "local" }],
    };
}

function saveLocalAgentProfile(input: { scope: AgentProfileScope; projectId?: string; canvasId?: string; content: string; revision: number }): AgentProfileView {
    const canvasId = input.canvasId || "workspace";
    const current = readLocalAgentProfile(canvasId, input.projectId);
    const revision = input.revision + 1;
    const next: AgentProfileView = {
        revision: `local-${revision}`,
        hash: `local-${revision}`,
        layers: [{ scope: input.scope, projectId: input.projectId, canvasId: input.canvasId, content: input.content, revision, hash: `local-${revision}` }],
    };
    const profiles = readLocalAgentProfiles();
    profiles[localAgentProfileKey(canvasId, input.projectId)] = next;
    writeLocalAgentProfiles(profiles);
    return next;
}

export function CanvasCloudAgentPanel({ canvasId, domainProjectId, nodeCount, references, open, prefillPrompt, onOpen, onCollapse, onFocusNode, onOpenPluginCenter }: CloudAgentPanelProps) {
    const theme = canvasThemes[useActiveTheme()];
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const storageMode = useUserStore((state) => state.storageMode);
    const user = useUserStore((state) => state.user);
    const localMode = isLocalWorkspaceMode() || storageMode === "local" || user?.username === "local" || import.meta.env.VITE_CANVAS_LOCAL_MODE !== "false";
    const reducedMotion = useReducedMotion();
    const [view, setView] = useState<AgentPanelView>("chat");
    const [run, setRun] = useState<AgentRun | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "reconnecting" | "disconnected">("connecting");
    const [connectionEpoch, setConnectionEpoch] = useState(0);
    const [messages, setMessages] = useState<CloudAgentChatMessage[]>([]);
    const [prompt, setPrompt] = useState("");
    const [prefillVisible, setPrefillVisible] = useState(false);
    const lastPrefillPromptRef = useRef("");
    const [reasoningMode, setReasoningMode] = useState<AgentReasoningMode>("off");
    const [profileView, setProfileView] = useState<AgentProfileView | null>(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileError, setProfileError] = useState<string>();
    const profileRequestRef = useRef(0);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
    const [marketSkills, setMarketSkills] = useState<Skill[]>([]);
    const [skillSearch, setSkillSearch] = useState("");
    const [debouncedSkillSearch, setDebouncedSkillSearch] = useState("");
    const [skillsLoading, setSkillsLoading] = useState(false);
    const [skillHasMore, setSkillHasMore] = useState(false);
    const [skillPage, setSkillPage] = useState(1);
    const [skillCategories, setSkillCategories] = useState<SkillCategory[]>([]);
    const [skillTag, setSkillTag] = useState("all");
    const [skillsOpen, setSkillsOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [approvalSubmitting, setApprovalSubmitting] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [approval, setApproval] = useState<ApprovalState | null>(null);
    const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>("request_approval");
    // Plain chat is conversation-scoped. Canvas context is opt-in and is
    // enabled when the user asks Agent to create or edit workspace content.
    const [contextScope, setContextScope] = useState<AgentContextKey[]>([]);
    const [maxGenerationTasks, setMaxGenerationTasks] = useState("0");
    const [maxVideoSeconds, setMaxVideoSeconds] = useState("0");
    const [conversations, setConversations] = useState<CloudAgentConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState(() => nanoid());
    const prefillConversationRef = useRef(activeConversationId);
    const [historyHydrated, setHistoryHydrated] = useState(false);
    const [pendingHydrated, setPendingHydrated] = useState(false);
    const [planMinimized, setPlanMinimized] = useState(false);
    const planItems = useMemo(() => latestAgentPlanItems(messages), [messages]);
    const planVisible = agentPlanVisible(planItems);
    const pendingQuestion = useMemo(() => pendingAgentQuestion(messages), [messages]);
    const panelLayout = useAgentPanelLayout();
    const lastSeqRef = useRef(0);
    const canvasSyncRef = useRef<ReturnType<typeof createAgentCanvasSync> | null>(null);
    useEffect(() => {
        const sync = createAgentCanvasSync({
            canvasId,
            applyPatches: (patches) => applyAgentCanvasPatches(canvasId, patches),
            refresh: () => refreshCanvasAfterAgent(canvasId),
            onError: (cause) => setMessages((current) => appendAgentError(current, `canvas-sync-${canvasId}`, cause, "画布同步冲突")),
        });
        canvasSyncRef.current = sync;
        return () => { sync.dispose(); if (canvasSyncRef.current === sync) canvasSyncRef.current = null; };
    }, [canvasId]);
    const skillPageRequestRef = useRef(false);
    const approvalRequestRef = useRef<string | null>(null);
    const pendingSubmission = useRef<CloudAgentPendingSubmission | null>(null);
    const submissionRequestRef = useRef(false);
    const conversationScope = `${canvasId}:${activeConversationId}`;
    const currentScope = useRef(conversationScope);
    currentScope.current = conversationScope;
    const running = Boolean(run?.cleanupPending) || run?.status === "running" || run?.status === "queued" || run?.status === "waiting_approval";
    const selectedModel = useMemo(() => {
        const textModels = selectableModelsByCapability(config, "text");
        const preferred = config.textModel || config.model || "";
        return textModels.includes(preferred) ? preferred : (textModels[0] || "");
    }, [config]);
    const reasoningSupported = Boolean(modelCapabilityConfigFor(config, selectedModel).text?.thinking);
    useEffect(() => { if (!reasoningSupported && reasoningMode !== "off") setReasoningMode("off"); }, [reasoningSupported, reasoningMode]);
    const installedSkills = useMemo(() => skills.filter((skill) => skill.isAdded), [skills]);
    const enabledSkills = useMemo(() => installedSkills.filter((skill) => selectedSkillIds.includes(skill.skillId)), [installedSkills, selectedSkillIds]);
    const status = run?.status || "idle";
    const statusLabel = status === "waiting_approval" ? "等待审批" : status === "running" || status === "queued" ? "运行中" : status === "completed" ? "已完成" : status === "failed" ? "异常" : status === "cancelled" ? "已停止" : status === "rejected" ? "已拒绝" : "待命";
    const statusColor = status === "failed" ? "#e66b6b" : status === "rejected" || status === "cancelled" ? theme.node.muted : status === "waiting_approval" ? "#d6a24a" : status === "running" || status === "queued" ? "#69c29b" : theme.node.muted;

    useEffect(() => {
        if (prefillConversationRef.current !== activeConversationId) {
            // A new/history conversation must not inherit a node reference from
            // the previous conversation, even though the parent canvas keeps
            // the last selected-node prefill available for the current panel.
            prefillConversationRef.current = activeConversationId;
            return;
        }
        const value = prefillPrompt?.trim();
        // Conversation hydration clears the composer once while the panel opens.
        // Re-apply the selected-node context after that reset, but avoid an
        // update loop once the reference is already present.
        if (!value || (value === lastPrefillPromptRef.current && (prompt.trim() || (historyHydrated && pendingHydrated)))) return;
        lastPrefillPromptRef.current = value;
        setPrefillVisible(true);
        setPrompt(value);
        setView("chat");
    }, [prefillPrompt, prompt, historyHydrated, pendingHydrated, activeConversationId]);

    useEffect(() => {
        if (!open || view !== "chat") setSkillsOpen(false);
    }, [open, view]);

    const reloadProfile = useCallback(async () => {
        const requestId = ++profileRequestRef.current;
        setProfileLoading(true);
        setProfileError(undefined);
        setProfileView(null);
        try {
            if (localMode) {
                const localProfile = readLocalAgentProfile(canvasId, domainProjectId);
                if (profileRequestRef.current === requestId) setProfileView(localProfile);
                return;
            }
            const result = await getAgentProfile({ projectId: domainProjectId, canvasId });
            if (profileRequestRef.current === requestId) setProfileView(result);
        } catch (cause) {
            if (profileRequestRef.current === requestId) setProfileError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (profileRequestRef.current === requestId) setProfileLoading(false);
        }
    }, [canvasId, domainProjectId, localMode]);

    useEffect(() => {
        if (!open) return;
        void reloadProfile();
    }, [open, reloadProfile]);

    const saveProfile = async (input: { scope: AgentProfileScope; projectId?: string; canvasId?: string; content: string; revision: number }) => {
        setProfileSaving(true);
        try {
            if (localMode) {
                const result = saveLocalAgentProfile(input);
                setProfileView(result);
                setProfileError(undefined);
                return result;
            }
            const result = await updateAgentProfile(input);
            setProfileView(result);
            setProfileError(undefined);
            return result;
        } finally {
            setProfileSaving(false);
        }
    };

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSkillSearch(skillSearch.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [skillSearch]);

    useEffect(() => {
        if (!open) return;
        let active = true;
        if (localMode) {
            setSkills([]);
            return () => { active = false; };
        }
        const refresh = () => { void listAddedSkills()
            .then((result) => {
                if (!active) return;
                setSkills(result.skills);
                setMessages((current) => current.filter((message) => message.id !== "skills-load-error"));
            })
            .catch((cause) => {
                if (!active) return;
                // 技能服务未启用时，空技能列表是有效的本地工作区状态；
                // 不要把初始化 404 渲染成 Agent 对话错误，避免遮挡新对话首屏。
                setSkills([]);
                setMessages((current) => current.filter((message) => message.id !== "skills-load-error"));
            }); };
        refresh();
        window.addEventListener("canvas-skills-changed", refresh);
        window.addEventListener("focus", refresh);
        return () => {
            active = false;
            window.removeEventListener("canvas-skills-changed", refresh);
            window.removeEventListener("focus", refresh);
        };
    }, [open, localMode]);

    useEffect(() => {
        if (view !== "settings" && !skillsOpen) return;
        if (localMode) {
            setMarketSkills([]);
            setSkillHasMore(false);
            setSkillsLoading(false);
            return;
        }
        let active = true;
        setSkillsLoading(true);
        void listSkills({
            scope: "public",
            search: debouncedSkillSearch || undefined,
            tag: skillsOpen && skillTag !== "all" ? skillTag : undefined,
            pageSize: 20,
            sort: "popular",
        })
            .then((result) => {
                if (active) {
                    setMarketSkills(result.skills);
                    setSkillHasMore(result.hasMore);
                    setSkillPage(result.page);
                    if (result.categories.length > 0) setSkillCategories(result.categories);
                }
            })
            .catch(() => {
                if (active) setMarketSkills([]);
            })
            .finally(() => {
                if (active) setSkillsLoading(false);
            });
        return () => {
            active = false;
        };
    }, [view, skillsOpen, debouncedSkillSearch, skillTag, localMode]);

    const loadMoreSkills = async () => {
        if (localMode || skillsLoading || skillPageRequestRef.current || !skillHasMore || skillSearch.trim() !== debouncedSkillSearch) return;
        skillPageRequestRef.current = true;
        setSkillsLoading(true);
        try {
            const result = await listSkills({
                scope: "public",
                search: debouncedSkillSearch || undefined,
                tag: skillsOpen && skillTag !== "all" ? skillTag : undefined,
                page: skillPage + 1,
                pageSize: 20,
                sort: "popular",
            });
            setMarketSkills((current) => [...current, ...result.skills.filter((skill) => !current.some((item) => item.skillId === skill.skillId))]);
            setSkillPage(result.page);
            setSkillHasMore(result.hasMore);
        } finally {
            skillPageRequestRef.current = false;
            setSkillsLoading(false);
        }
    };

    useEffect(() => {
        let active = true;
        setHistoryHydrated(false);
        setPendingHydrated(false);
        pendingSubmission.current = null;
        setBusy(false);
        setConversations([]);
        setRun(null);
        setMessages([]);
        setApproval(null);
        setApprovalSubmitting(false);
        approvalRequestRef.current = null;
        setPrompt("");
        void loadCloudAgentConversations(canvasId)
            .then(async (document) => {
                if (!active) return;
                const current = document.conversations.find((conversation) => conversation.id === document.activeId) || document.conversations[0];
                // 旧版本可能只留下一个 404/接口错误消息。它不是有效的对话，
                // 首次打开时应回到 LibTV 风格的“新对话”空状态；真正有用户/助手
                // 内容的历史仍然完整保留。
                const staleErrorOnlyConversation = Boolean(current && current.messages.length > 0 && current.messages.every((message) => message.role === "error" || message.role === "system"));
                const usableCurrent = current && !staleErrorOnlyConversation ? current : undefined;
                const nextConversations = staleErrorOnlyConversation ? document.conversations.filter((conversation) => conversation.id !== current?.id) : document.conversations;
                setConversations(nextConversations);
                if (usableCurrent) {
                    setActiveConversationId(usableCurrent.id);
                    setMessages(usableCurrent.messages);
                    setRun(usableCurrent.run);
                    setPermissionMode(usableCurrent.permissionMode);
                    setSelectedSkillIds(usableCurrent.skillIds || []);
                    if (usableCurrent.model) setModel(usableCurrent.model);
                    const pending = await loadCloudAgentPendingSubmission(canvasId, usableCurrent.id);
                    if (!active) return;
                    pendingSubmission.current = pending;
                    if (pending?.request) setPrompt(pending.request.prompt);
                } else {
                    setActiveConversationId(nanoid());
                    pendingSubmission.current = null;
                }
                setPendingHydrated(true);
            })
            .catch((cause) => {
                if (!active) return;
                setMessages((current) => appendAgentError(current, "history-error", cause, "对话恢复失败，已暂停发送；请重新打开对话核对"));
            })
            .finally(() => {
                if (active) setHistoryHydrated(true);
            });
        return () => {
            active = false;
        };
    }, [canvasId]);

    useEffect(() => {
        if (!historyHydrated || (!messages.length && !run)) return;
        const now = new Date().toISOString();
        setConversations((current) => {
            const existing = current.find((conversation) => conversation.id === activeConversationId);
            const next: CloudAgentConversation = {
                id: activeConversationId,
                title: cloudAgentConversationTitle(messages),
                messages,
                run,
                model: selectedModel || undefined,
                permissionMode,
                skillIds: selectedSkillIds,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
            };
            return [next, ...current.filter((conversation) => conversation.id !== activeConversationId)];
        });
    }, [activeConversationId, historyHydrated, messages, permissionMode, run, selectedModel, selectedSkillIds]);

    useEffect(() => {
        if (!historyHydrated) return;
        const timer = window.setTimeout(() => {
            void saveCloudAgentConversations(canvasId, activeConversationId, conversations);
        }, 180);
        return () => window.clearTimeout(timer);
    }, [activeConversationId, canvasId, conversations, historyHydrated]);

    useEffect(() => {
        if (!run?.id) return;
        lastSeqRef.current = 0;
        return subscribeAgentEvents(
            run.id,
            (event) => {
                // Only persisted agent events participate in the replay cursor.
                // Snapshot-derived UI events intentionally use seq=0.
                if (event.seq > 0) {
                    if (event.seq <= lastSeqRef.current) return;
                    if (event.seq > lastSeqRef.current + 1) canvasSyncRef.current?.reconcile();
                    lastSeqRef.current = event.seq;
                }
                setMessages((current) => current.filter((item) => item.id !== `stream-error-${run.id}`));
                applyAgentEvent(event, setMessages, setRun, setApproval, setPrompt);
                canvasSyncRef.current?.receive(event);
            },
            {
                after: 0,
                onConnectionChange: setConnectionStatus,
                onError: (cause) => {
                    canvasSyncRef.current?.reconcile();
                    setMessages((current) => appendAgentError(current, `stream-error-${run.id}`, cause, "Agent 事件流已断开"));
                    // The observation channel failed, not the durable run. Keep
                    // identity and approval so reconnect/cancel/continue remain available.
                    setConnectionStatus("disconnected");
                },
            },
        );
    }, [run?.id, connectionEpoch]);

    useEffect(() => {
        if (!run?.id || connectionStatus !== "disconnected") return;
        const reconnect = () => setConnectionEpoch((value) => value + 1);
        window.addEventListener("online", reconnect);
        return () => window.removeEventListener("online", reconnect);
    }, [run?.id, connectionStatus]);

    const interject = async (value: string) => {
        const activeRun = run;
        if (!value || !activeRun?.id || busy || connectionStatus !== "connected" || currentScope.current !== conversationScope || !historyHydrated) return;
        const scope = conversationScope;
        const messageId = `user-${crypto.randomUUID()}`;
        setBusy(true);
        try {
            await sendAgentInterjection(activeRun.id, { text: value, messageId });
            if (currentScope.current !== scope) return;
            setPrompt("");
            setMessages((current) => appendUniqueMessage(current, { id: messageId, role: "user", text: value, interjection: "sent" }));
        } catch (cause) {
            if (currentScope.current !== scope) return;
            const status = (cause as { status?: number }).status;
            setMessages((current) => appendAgentError(current, `interject-error-${activeConversationId}-${messageId}`, cause, "插话没有送达"));
            if (status === 409) setPrompt(value);
        } finally {
            if (currentScope.current === scope) setBusy(false);
        }
    };

    const submit = async (override?: string) => {
        const value = (override ?? (prompt || (prefillVisible ? (prefillPrompt || "") : ""))).trim();
        if (running) {
            await interject(value);
            return;
        }
        if (!value || busy || running || (run && connectionStatus !== "connected") || submissionRequestRef.current || !historyHydrated || !pendingHydrated || currentScope.current !== conversationScope) return;
        setPrefillVisible(false);
        const scope = conversationScope;
        submissionRequestRef.current = true;
        setBusy(true);
        let accepted = false;
        try {
            const pending = pendingSubmission.current;
            // An ambiguous previous POST owns its body/key until reconciled.
            // Editing model settings or prompt must not silently create a new charge.
            if (pending?.request && pending.request.prompt !== value) throw new Error("上一条请求结果待确认，请先原样重试上一条消息，再发送新要求");
            if (!pending?.request) {
                if (profileLoading) throw new Error("正在确认长期偏好快照，请稍后再发送");
                if (!profileView || profileError) throw new Error("长期偏好快照尚未确认，请重新读取后再发送");
                if (!localMode) {
                    const capabilities = await getAgentCapabilities();
                    if (currentScope.current !== scope) return;
                    if (!capabilities.permissionModes.includes(permissionMode)) throw new Error("当前后端不支持所选 Agent 权限，请更新后端");
                    if (selectedSkillIds.length && !capabilities.skills) throw new Error("当前后端尚未接入技能库");
                }
                if (hasRemoteUserDataSyncSession()) await saveRemoteUserDataNow();
                // Always materialize the current canvas in the co-packaged Go
                // repository before Agent admission. Runtime mode can settle
                // after the canvas was created, so gating this on the React
                // mode flag creates a frontend-only canvas that the Agent API
                // cannot resolve (404). The PUT is idempotent and therefore
                // safe for both desktop and hosted-compatible flows.
                if (contextScope.includes("canvas")) await syncLocalCanvasForAgent(canvasId);
                if (currentScope.current !== scope) return;
                const agentConfig = { ...config, model: selectedModel };
                const requestConfig = resolveModelRequestConfig(agentConfig, selectedModel);
                const logicalModelId = logicalModelIDForConfig(agentConfig);
                const input: Omit<CreateAgentRunInput, "idempotencyKey"> = {
                    conversationId: activeConversationId,
                    ...(contextScope.includes("canvas") ? { canvasId } : {}), prompt: value, reasoningMode: reasoningSupported ? reasoningMode : "off",
                    // Local profiles live in the desktop WebView and are not
                    // the server's persisted profile snapshot. Sending their
                    // `local-*` revision makes every request look stale to
                    // the Go Agent's hash-based revision contract.
                    ...(localMode ? {} : { profileRevision: profileView.revision }),
                    model: modelOptionName(selectedModel) || undefined,
                    ...(logicalModelId ? { logicalModelId } : requestConfig.channelId ? { channelId: requestConfig.channelId, channelModelKey: modelOptionName(selectedModel) || undefined } : {}),
                    skillIds: [...new Set([...selectedSkillIds, ...resolveSkillMentions(value, installedSkills).map((skill) => skill.skillId)])],
                    permissionMode, contextScope,
                    budget: { maxGenerationTasks: permissionMode === "read_only" ? 0 : Number(maxGenerationTasks), maxVideoSeconds: permissionMode === "read_only" ? 0 : Number(maxVideoSeconds) },
                };
                const fingerprint = JSON.stringify({ scope, parent: run?.id, input });
                if (pending && pending.fingerprint !== fingerprint) throw new Error("上一条请求尚未确认，请恢复原消息与设置后核对，不能覆盖原幂等记录");
                const key = pending?.key || crypto.randomUUID();
                const next = { fingerprint, key, request: { ...input, idempotencyKey: key }, parentRunId: run?.id, messageId: `user-${key}` };
                // Persist before sending. A failed local save must not submit a request
                // whose recovery identity will disappear on reload.
                await saveCloudAgentPendingSubmission(canvasId, activeConversationId, next);
                if (currentScope.current !== scope) return;
                pendingSubmission.current = next;
            }
            const submission = pendingSubmission.current!;
            const request = localMode
                ? { ...submission.request!, profileRevision: undefined }
                : submission.request!;
            const nextMessages = appendUniqueMessage(messages, { id: submission.messageId || `user-${submission.key}`, role: "user", text: request.prompt });
            const now = new Date().toISOString();
            const existing = conversations.find((item) => item.id === activeConversationId);
            // Persist a discoverable conversation before POST as well as its key;
            // otherwise a reload of a brand-new chat can orphan the pending record.
            await saveCloudAgentConversations(canvasId, activeConversationId, [{
                id: activeConversationId, title: cloudAgentConversationTitle(nextMessages), messages: nextMessages, run,
                model: selectedModel || undefined, permissionMode, skillIds: selectedSkillIds,
                createdAt: existing?.createdAt || now, updatedAt: now,
            }, ...conversations.filter((item) => item.id !== activeConversationId)]);
            if (currentScope.current !== scope) return;
            setPrompt("");
            setMessages(nextMessages);
            const result = submission.parentRunId ? await sendAgentMessage(submission.parentRunId, request) : await createAgentRun(request);
            accepted = true;
            if (currentScope.current === scope) setRun(result.run);
            await clearCloudAgentPendingSubmission(canvasId, activeConversationId);
            if (currentScope.current === scope) pendingSubmission.current = null;
        } catch (cause) {
            if (currentScope.current !== scope) return;
            if (!accepted) {
                setPrompt(value);
                const status = (cause as { status?: number }).status;
                if (status && [400, 401, 403, 404, 422].includes(status)) {
                    // These admission responses explicitly rejected the write.
                    // Transport errors and conflicts retain the pending identity.
                    try {
                        await clearCloudAgentPendingSubmission(canvasId, activeConversationId);
                        pendingSubmission.current = null;
                    } catch (storageError) {
                        setMessages((current) => appendAgentError(current, `pending-storage-${activeConversationId}`, storageError, "提交记录更新失败"));
                    }
                }
            }
            setMessages((current) => appendAgentError(current, `submit-error-${activeConversationId}`, cause, agentSubmissionErrorTitle(cause, accepted)));
        } finally {
            submissionRequestRef.current = false;
            if (currentScope.current === scope) setBusy(false);
        }
    };

    const stop = async () => {
        const activeRun = run;
        if (!activeRun?.id || stopping) return;
        setStopping(true);
        try {
            await cancelAgentRun(activeRun.id);
            const snapshot = await getAgentRun(activeRun.id, AbortSignal.timeout(5_000));
            if (currentScope.current === conversationScope) {
                setRun((current) => current?.id === activeRun.id ? snapshot.run : current);
                if (!snapshot.run.approval) setApproval(null);
                setConnectionEpoch((value) => value + 1);
            }
        } catch (cause) {
            if (currentScope.current === conversationScope) {
                // An ambiguous cancellation is not proof of a terminal run. Keep
                // the run and approval until the server confirms their state.
                setConnectionEpoch((value) => value + 1);
                setMessages((current) => appendAgentError(current, `cancel-${activeRun.id}`, cause, "取消结果未确认，正在重新核对运行状态"));
            }
        } finally {
            setStopping(false);
        }
    };

    const submitApproval = async (decision: "approve" | "reject", mediaSettings?: AgentMediaSettings) => {
        if (!run || !approval || connectionStatus !== "connected" || approvalRequestRef.current === approval.approvalId) return;
        const runId = run.id;
        const approvalId = approval.approvalId;
        const scope = conversationScope;
        approvalRequestRef.current = approvalId;
        setApprovalSubmitting(true);
        try {
            if (decision === "approve" && hasRemoteUserDataSyncSession()) await saveRemoteUserDataNow();
            if (currentScope.current !== scope) return;
            await decideAgentApproval(runId, approvalId, decision, approval.reason, AbortSignal.timeout(15_000), mediaSettings);
            if (currentScope.current === scope) {
                setApproval((current) => current?.approvalId === approvalId ? null : current);
                setRun((current) => current?.id === runId && current.status === "waiting_approval" && (!current.approval || current.approval.approvalId === approvalId) ? { ...current, status: decision === "reject" ? "rejected" : "running", approval: undefined } : current);
            }
        } catch (cause) {
            if (currentScope.current !== scope) return;
            // A timed-out response is ambiguous: query the durable decision before
            // asking the user to retry. The backend treats identical decisions idempotently.
            try {
                const snapshot = await getAgentRun(runId, AbortSignal.timeout(5_000));
                const decided = snapshot.run.events?.some((event) => event.type === "approval_decided" && event.payload.approvalId === approvalId && event.payload.decision === decision && (!mediaSettings || agentApprovalMatchesSettings(event.payload.arguments, mediaSettings)));
                if (decided) {
                    setApproval((current) => current?.approvalId === approvalId ? null : current);
                    setRun(snapshot.run);
                    return;
                }
            } catch {
                // Preserve the pending approval so the same decision can be retried.
            }
            setMessages((current) => appendAgentError(current, `approval-error-${Date.now()}`, cause, "审批未确认，请重试"));
        } finally {
            if (approvalRequestRef.current === approvalId) approvalRequestRef.current = null;
            if (currentScope.current === scope) setApprovalSubmitting(false);
        }
    };

    const installSkill = async (skill: Skill) => {
        if (skill.isAdded) return;
        try {
            const result = await addSkill(skill.skillId);
            setSkills((current) => [...current.filter((item) => item.skillId !== skill.skillId), result.skill]);
            setMarketSkills((current) => current.map((item) => (item.skillId === skill.skillId ? result.skill : item)));
            setSelectedSkillIds((current) => (current.includes(skill.skillId) ? current : [...current, skill.skillId]));
        } catch (cause) {
            setMessages((current) => appendAgentError(current, `skill-error-${Date.now()}`, cause, "添加 Skill 失败"));
        }
    };

    const setModel = (model: string) => {
        updateConfig("textModel", model);
        updateConfig("model", model);
    };

    const newConversation = () => {
        const id = nanoid();
        currentScope.current = `${canvasId}:${id}`;
        setPendingHydrated(true);
        setPrefillVisible(false);
        setBusy(false);
        pendingSubmission.current = null;
        approvalRequestRef.current = null;
        setApprovalSubmitting(false);
        setActiveConversationId(id);
        setRun(null);
        setMessages([]);
        setPrompt("");
        setApproval(null);
        lastSeqRef.current = 0;
        setView("chat");
    };

    const openConversation = (conversation: CloudAgentConversation) => {
        currentScope.current = `${canvasId}:${conversation.id}`;
        setPendingHydrated(false);
        setPrefillVisible(false);
        setBusy(false);
        pendingSubmission.current = null;
        approvalRequestRef.current = null;
        setApprovalSubmitting(false);
        setActiveConversationId(conversation.id);
        setRun(conversation.run);
        setMessages(conversation.messages);
        setPermissionMode(conversation.permissionMode);
        setSelectedSkillIds(conversation.skillIds || []);
        setApproval(null);
        setPrompt("");
        if (conversation.model) setModel(conversation.model);
        setView("chat");
        void loadCloudAgentPendingSubmission(canvasId, conversation.id).then((pending) => {
            if (currentScope.current === `${canvasId}:${conversation.id}`) {
                pendingSubmission.current = pending;
                setPendingHydrated(true);
                if (pending?.request) setPrompt(pending.request.prompt);
            }
        }).catch((cause) => {
            if (currentScope.current === `${canvasId}:${conversation.id}`) setMessages((current) => appendAgentError(current, `pending-${conversation.id}`, cause, "待确认请求读取失败"));
        });
    };
    const deleteConversation = (id: string) => {
        const next = conversations.filter((item) => item.id !== id);
        setConversations(next);
        if (id === activeConversationId) newConversation();
        void saveCloudAgentConversations(canvasId, id === activeConversationId ? null : activeConversationId, next);
    };

    return (
        <>
            <AnimatePresence>
                {open ? (
                    <motion.aside
                        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.975 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.985 }}
                        transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
                        className={cn("canvas-agent-panel fixed z-[var(--z-modal-overlay)] flex min-w-0 flex-col overflow-hidden rounded-2xl border max-sm:rounded-b-none", panelLayout.docked && "canvas-agent-panel--docked")}
                        data-agent-docked={panelLayout.docked ? "true" : "false"}
                        data-agent-view={view}
                        data-agent-status={status}
                        data-agent-prefill={prefillPrompt || ""}
                        style={{ ...panelLayout.style, background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 28px 90px ${theme.spatial.shadow}` }}
                        aria-label="Agent 工作台"
                        data-canvas-no-zoom
                        data-canvas-wheel-scroll
                        {...panelLayout.pointerHandlers}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <div data-agent-resize="north" className="absolute inset-x-5 top-0 z-10 hidden h-2 cursor-n-resize touch-none sm:block" />
                        <div data-agent-resize="west" className="absolute bottom-5 left-0 top-5 z-10 hidden w-2 cursor-w-resize touch-none sm:block" />
                        <button
                            type="button"
                            aria-label="调整 Agent 面板大小"
                            title="拖动调整宽高，也可用方向键调整"
                            data-agent-resize="northwest"
                            className="absolute left-0 top-0 z-10 hidden size-5 cursor-nw-resize touch-none opacity-50 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 sm:block"
                            onKeyDown={panelLayout.onResizeKeyDown}
                        >
                            <span className="absolute left-1.5 top-1.5 size-2 border-l-2 border-t-2 rounded-tl" style={{ borderColor: theme.node.muted }} />
                        </button>
                        <AnimatePresence mode="wait" initial={false}>
                            {view === "settings" ? (
                                <motion.div key="settings" className="flex min-h-0 flex-1" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
                                    <CanvasCloudAgentSettings
                                        theme={theme}
                                        config={config}
                                        selectedModel={selectedModel}
                                        permissionMode={permissionMode}
                                        contextScope={contextScope}
                                        nodeCount={nodeCount}
                                        installedSkills={installedSkills}
                                        marketSkills={marketSkills}
                                        selectedSkillIds={selectedSkillIds}
                                        skillSearch={skillSearch}
                                        skillsLoading={skillsLoading}
                                        skillHasMore={skillHasMore}
                                        maxGenerationTasks={maxGenerationTasks}
                                        maxVideoSeconds={maxVideoSeconds}
                                        onBack={() => setView("chat")}
                                        onModelChange={setModel}
                                        onPermissionChange={setPermissionMode}
                                        reasoningMode={reasoningMode}
                                        onReasoningModeChange={setReasoningMode}
                                        profileView={profileView}
                                        profileLoading={profileLoading}
                                        profileSaving={profileSaving}
                                        profileError={profileError}
                                        projectId={domainProjectId}
                                        canvasId={canvasId}
                                        onReloadProfile={reloadProfile}
                                        onSaveProfile={saveProfile}
                                        onContextToggle={(value) => setContextScope((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))}
                                        onSkillSearch={setSkillSearch}
                                        onSkillToggle={(id) => setSelectedSkillIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))}
                                        onSkillInstall={installSkill}
                                        onLoadMoreSkills={loadMoreSkills}
                                        onMaxGenerationTasksChange={setMaxGenerationTasks}
                                        onMaxVideoSecondsChange={setMaxVideoSeconds}
                                    />
                                </motion.div>
                            ) : view === "history" ? (
                                <motion.div key="history" className="flex min-h-0 flex-1" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
                                    <AgentHistory
                                        conversations={conversations}
                                        activeConversationId={activeConversationId}
                                        theme={theme}
                                        onBack={() => setView("chat")}
                                        onNew={newConversation}
                                        onOpen={openConversation}
                                        onDelete={deleteConversation}
                                    />
                                </motion.div>
                            ) : (
                                <motion.div key="chat" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
                                    <AgentHeader
                                        theme={theme}
                                        title={messages.length ? "Agent" : "新对话"}
                                        statusLabel={statusLabel}
                                        statusColor={statusColor}
                                        nodeCount={nodeCount}
                                        onNew={newConversation}
                                        onHistory={() => setView("history")}
                                        onSettings={() => setView("settings")}
                                        onOpenPluginCenter={onOpenPluginCenter}
                                        onShare={() => { void navigator.clipboard?.writeText(window.location.href); }}
                                        onCollapse={onCollapse}
                                    />
                                    {run && connectionStatus !== "connected" ? (
                                        <div role="status" className="flex items-center justify-between gap-2 px-5 py-2 text-xs" style={{ color: theme.node.muted }}>
                                            <span>{connectionStatus === "disconnected" ? "连接已断开，服务端任务可能仍在执行；运行记录已保留" : "正在连接并校准运行状态…"}</span>
                                            {connectionStatus === "disconnected" ? <Button size="small" onClick={() => setConnectionEpoch((value) => value + 1)}>重新连接</Button> : null}
                                        </div>
                                    ) : null}
                                    <AgentConversation
                                        key={activeConversationId}
                                        theme={theme}
                                        messages={messages}
                                        onFocusNode={onFocusNode}
                                        references={[...references, ...buildSkillMentionReferences(installedSkills)]}
                                        busy={busy || running}
                                        approval={approval}
                                        nodeCount={nodeCount}
                                        recommendedSkills={installedSkills.slice(0, 4)}
                                        onPrompt={(value) => setPrompt(value)}
                                        approvalSubmitting={approvalSubmitting || connectionStatus !== "connected"}
                                        onApprovalReasonChange={(reason) => setApproval((current) => (current ? { ...current, reason } : current))}
                                        onApprove={(settings) => void submitApproval("approve", settings)}
                                        onReject={() => void submitApproval("reject")}
                                    />
                                    {planVisible ? <AgentPlanBar items={planItems} theme={theme} minimized={planMinimized} onToggle={() => setPlanMinimized((value) => !value)} /> : null}
                                    {pendingQuestion ? (
                                        <AgentQuestionBar
                                            question={pendingQuestion}
                                            theme={theme}
                                            disabled={approvalSubmitting || connectionStatus !== "connected"}
                                            onAnswer={(label) => void submit(label)}
                                        />
                                    ) : null}
                                    <AgentChatComposer
                                        prompt={prompt || (prefillVisible ? (prefillPrompt || "") : "")}
                                        disabled={Boolean(run && connectionStatus !== "connected") || !historyHydrated || !pendingHydrated}
                                        sending={busy}
                                        running={running}
                                        placeholder={running ? "运行中可直接插话，会在它下一步生效" : "开始你的创作，或者 @ 引用工作流/节点/资源"}
                                        theme={theme}
                                        onPromptChange={(value) => {
                                            if (value !== prefillPrompt) setPrefillVisible(false);
                                            setPrompt(value);
                                        }}
                                        onSubmit={() => void submit()}
                                        onStop={run?.id && running ? stop : undefined}
                                        stopping={stopping}
                                        references={[...references, ...buildSkillMentionReferences(installedSkills)]}
                                        slashSkills={installedSkills}
                                        includeAssetLibrary={false}
                                        compact={panelLayout.docked}
                                        left={
                                            <ComposerControls
                                                compact={panelLayout.docked}
                                                reasoningMode={reasoningSupported ? reasoningMode : "off"}
                                                reasoningSupported={reasoningSupported}
                                                onReasoningModeChange={(value) => { if (reasoningSupported) setReasoningMode(value); }}
                                                config={config}
                                                selectedModel={selectedModel}
                                                permissionMode={permissionMode}
                                                theme={theme}
                                                onModelChange={setModel}
                                                onPermissionChange={setPermissionMode}
                                                skillsOpen={skillsOpen}
                                                onSkillsOpenChange={setSkillsOpen}
                                                selectedSkillCount={selectedSkillIds.length}
                                            />
                                        }
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.aside>
                ) : null}
            </AnimatePresence>
            <CanvasAgentSkillLibraryModal
                open={skillsOpen}
                theme={theme}
                installedSkills={installedSkills}
                marketSkills={marketSkills}
                selectedSkillIds={selectedSkillIds}
                categories={skillCategories}
                category={skillTag}
                search={skillSearch}
                loading={skillsLoading}
                hasMore={skillHasMore}
                onClose={() => setSkillsOpen(false)}
                onCategoryChange={setSkillTag}
                onSearch={setSkillSearch}
                onToggle={(id) => setSelectedSkillIds((current) => {
                    if (current.includes(id)) return current.filter((item) => item !== id);
                    return [...current, id];
                })}
                onInstall={installSkill}
                onLoadMore={loadMoreSkills}
            />
        </>
    );
}

function AgentHeader({ theme, title, statusLabel, statusColor, nodeCount, onNew, onHistory, onSettings, onOpenPluginCenter, onShare, onCollapse }: { theme: CanvasTheme; title: string; statusLabel: string; statusColor: string; nodeCount: number; onNew: () => void; onHistory: () => void; onSettings: () => void; onOpenPluginCenter?: () => void; onShare: () => void; onCollapse: () => void }) {
    return (
        <header data-agent-drag-handle className="canvas-agent-header flex h-[68px] shrink-0 items-center gap-3 px-4" style={{ boxShadow: `inset 0 -1px 0 ${theme.toolbar.border}` }}>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{title}</span>
                    {title === "Agent" || statusLabel !== "待命" ? (
                        <span className="flex items-center gap-1 text-[11px]" style={{ color: statusColor }}>
                            <CircleDot className="size-3" />
                            {statusLabel}
                        </span>
                    ) : null}
                </div>
                <div className="canvas-agent-header-context mt-0.5 text-[11px] opacity-40">当前画布 · {nodeCount} 个节点</div>
            </div>
            <div className="flex items-center gap-0.5">
                <Button type="text" shape="circle" icon={<MessageSquarePlus className="size-4" />} onClick={onNew} aria-label="新建对话" title="新建对话" />
                <Button type="text" shape="circle" icon={<History className="size-4" />} onClick={onHistory} aria-label="历史对话" title="历史对话" />
                <Button type="text" shape="circle" icon={<Share2 className="size-4" />} onClick={onShare} aria-label="复制对话链接" title="复制对话链接" />
                <Button type="text" shape="circle" icon={<Settings2 className="size-4" />} onClick={onSettings} aria-label="Agent 设置" title="Agent 设置" />
                {onOpenPluginCenter ? <Button type="text" shape="circle" icon={<Puzzle className="size-4" />} onClick={onOpenPluginCenter} aria-label="LibTV Plugin" title="LibTV Plugin" /> : null}
                <Button type="text" shape="circle" icon={<Minus className="size-4" />} onClick={onCollapse} aria-label="收起 Agent" title="收起" />
            </div>
        </header>
    );
}

function AgentHistory({ conversations, activeConversationId, theme, onBack, onNew, onOpen, onDelete }: { conversations: CloudAgentConversation[]; activeConversationId: string; theme: CanvasTheme; onBack: () => void; onNew: () => void; onOpen: (conversation: CloudAgentConversation) => void; onDelete: (id: string) => void }) {
    return (
        <div className="canvas-agent-history-root flex min-h-0 min-w-0 flex-1 flex-col">
            <header data-agent-drag-handle className="flex h-[68px] shrink-0 items-center gap-2 px-3" style={{ boxShadow: `inset 0 -1px 0 ${theme.toolbar.border}` }}>
                <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} onClick={onBack} aria-label="返回对话" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">历史对话</div>
                    <div className="mt-0.5 text-[11px] opacity-40">保存在当前账号与画布下</div>
                </div>
                <Button type="text" shape="circle" icon={<MessageSquarePlus className="size-4" />} onClick={onNew} aria-label="新建对话" title="新建对话" />
            </header>
            <div className="canvas-agent-history-scroll thin-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3">
                {conversations.length ? (
                    <div className="space-y-1">
                        {conversations.map((conversation) => {
                            const preview = truncateConversationPreview(conversation.messages.at(-1)?.text || "尚未发送消息");
                            const active = conversation.id === activeConversationId;
                            return (
                                <div key={conversation.id} className="canvas-agent-history-item group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors" style={{ background: active ? theme.toolbar.itemHover : "transparent", color: theme.node.text }}>
                                    <button type="button" className="canvas-agent-history-open flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpen(conversation)} aria-current={active ? "page" : undefined}>
                                        <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: theme.node.fill, color: theme.node.muted }}><Clock3 className="size-3.5" /></span>
                                        <span className="canvas-agent-history-text min-w-0 flex-1">
                                            <span className="canvas-agent-history-title block truncate text-[13px] font-medium">{conversation.title}</span>
                                            <span className="canvas-agent-history-preview mt-0.5 block text-[11px] opacity-40" title={preview}>{preview}</span>
                                        </span>
                                        <span className="canvas-agent-history-time shrink-0 text-[10px] opacity-35">{formatConversationTime(conversation.updatedAt)}</span>
                                    </button>
                                    <Button type="text" size="small" danger className="canvas-agent-history-delete !h-7 !px-2 !text-xs !opacity-80" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(conversation.id)} aria-label={`删除对话 ${conversation.title}`} title="删除对话">删除</Button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                        <History className="size-5 opacity-30" />
                        <div className="mt-3 text-sm font-medium">还没有历史对话</div>
                        <div className="mt-1 text-xs opacity-40">发送第一条消息后会自动保存</div>
                    </div>
                )}
            </div>
        </div>
    );
}

function AgentConversation({
    theme,
    messages,
    references,
    busy,
    approval,
    approvalSubmitting,
    nodeCount,
    recommendedSkills,
    onPrompt,
    onFocusNode,
    onApprovalReasonChange,
    onApprove,
    onReject,
}: {
    theme: CanvasTheme;
    messages: CloudAgentChatMessage[];
    references: CanvasResourceReference[];
    busy: boolean;
    approval: ApprovalState | null;
    approvalSubmitting: boolean;
    nodeCount: number;
    recommendedSkills: Skill[];
    onPrompt: (value: string) => void;
    onFocusNode?: (nodeId: string) => void;
    onApprovalReasonChange: (reason: string) => void;
    onApprove: (settings?: AgentMediaSettings) => void;
    onReject: () => void;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [browserNoticeOpen, setBrowserNoticeOpen] = useState(true);
    const followRef = useRef(true);
    const lastUserId = messages.findLast((item) => item.role === "user")?.id;

    // 自己发送时恢复跟随；阅读旧消息时不让流式输出抢走滚动位置。
    useLayoutEffect(() => {
        followRef.current = true;
    }, [lastUserId]);
    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (element && followRef.current) element.scrollTop = element.scrollHeight;
    }, [messages, busy, approval]);
    useEffect(() => {
        const element = scrollRef.current;
        const content = contentRef.current;
        if (!element || !content) return;
        const observer = new ResizeObserver(() => {
            if (followRef.current) element.scrollTop = element.scrollHeight;
        });
        observer.observe(element);
        observer.observe(content);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={scrollRef} data-agent-conversation className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5" onScroll={(event) => {
            const element = event.currentTarget;
            followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}>
            {!messages.length ? <AgentEmptyState theme={theme} nodeCount={nodeCount} recommendedSkills={recommendedSkills} browserNoticeOpen={browserNoticeOpen} onDismissNotice={() => setBrowserNoticeOpen(false)} onPrompt={onPrompt} /> : null}
            <div ref={contentRef} className="space-y-2.5">
                {messages.map((item) => (
                    <AgentChatMessage key={item.id} item={item} theme={theme} references={references} onFocusNode={onFocusNode} isStreaming={busy && !approval && item.streaming === true && item === messages.at(-1)} />
                ))}
                {approval ? <ApprovalCard key={approval.approvalId} approval={approval} theme={theme} submitting={approvalSubmitting} onFocusNode={onFocusNode} onReasonChange={onApprovalReasonChange} onApprove={onApprove} onReject={onReject} /> : null}
                {busy && !approval ? (
                    <AgentWorkingMessage theme={theme} label="正在处理当前画布" />
                ) : null}
            </div>
        </div>
    );
}

function AgentEmptyState({ theme, nodeCount, recommendedSkills, browserNoticeOpen, onDismissNotice, onPrompt }: { theme: CanvasTheme; nodeCount: number; recommendedSkills: Skill[]; browserNoticeOpen: boolean; onDismissNotice: () => void; onPrompt: (value: string) => void }) {
    const fallbackCards = [
        { title: "皮克斯风格角色", prompt: "参考当前画布，设计一组皮克斯风格的角色设定", skillId: "pixar-animation", tone: "from-[#8d5f3e] to-[#d4a06a]", image: "/short-drama-styles/three-d-cartoon.jpg" },
        { title: "爆款拉片分析", prompt: "分析当前画布并给出一份爆款短视频拆解", skillId: "viral-video-analysis", tone: "from-[#47556f] to-[#a17d62]", image: "/short-drama-styles/comic-pop.jpg" },
        { title: "新中式场景", prompt: "为当前画布补充一套新中式场景方案", skillId: "neo-chinese-scene", tone: "from-[#39645c] to-[#9e8064]", image: "/short-drama-styles/chinese-2d.jpg" },
        { title: "古典武侠分镜", prompt: "把当前画布整理成古典武侠分镜", skillId: "hujinquan-wuxia", tone: "from-[#34485a] to-[#71818a]", image: "/short-drama-styles/period-live-action.jpg" },
    ];
    const cards: Array<{ title: string; prompt: string; tone: string; image: string; skillId?: string }> = fallbackCards.map((fallback, index) => {
        const skill = recommendedSkills[index];
        return { ...fallback, ...(skill ? { title: skill.skillName || fallback.title, prompt: `使用 Skill「${skill.skillName || fallback.title}」处理当前画布`, skillId: skill.skillId } : {}) };
    });
    return (
        <div className="flex min-h-full flex-col px-3 pb-4 pt-8" data-agent-empty-state>
            <div className="mt-auto">
                <div className="flex items-center justify-between px-1">
                    <h2 className="text-base font-semibold">新的一天，新的 Skill</h2>
                    <button type="button" className="text-xs opacity-55 transition-opacity hover:opacity-100" onClick={() => onPrompt("换一批适合当前画布的 Skill")}>↔ 换一批</button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    {cards.map((card) => (
                        <button key={card.title} type="button" className="group flex min-h-[62px] min-w-0 items-center gap-2 overflow-hidden rounded-xl border p-2 text-left transition-transform hover:-translate-y-0.5" style={{ borderColor: theme.toolbar.border, background: theme.node.fill }} onClick={() => onPrompt(card.prompt)}>
                            <span className={`h-7 w-10 shrink-0 rounded-full bg-cover bg-center bg-gradient-to-br ${card.tone}`} style={{ backgroundImage: `linear-gradient(135deg, rgb(0 0 0 / 0.04), rgb(0 0 0 / 0.34)), url("${card.image}")` }} aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">{card.title}</span>
                                <span className="block max-w-[58px] truncate text-[10px] opacity-40">{card.skillId ? `/${card.skillId}` : "/canvas-skill"}</span>
                            </span>
                        </button>
                    ))}
                </div>
                {browserNoticeOpen ? (
                    <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: "#20345d", color: "#dbe6ff" }}>
                        <span className="min-w-0 flex-1 truncate">开启浏览器通知，及时获取最新消息</span>
                        <button type="button" className="shrink-0 opacity-80 hover:opacity-100" onClick={() => onPrompt("开启浏览器通知")}>开启</button>
                        <button type="button" className="shrink-0 opacity-70 hover:opacity-100" aria-label="关闭浏览器通知" onClick={onDismissNotice}>×</button>
                    </div>
                ) : null}
                <p className="agent-empty-state-meta mt-3 px-1 text-[10px] opacity-35">当前画布有 {nodeCount} 个节点 · 点击 Skill 卡片即可开始</p>
            </div>
        </div>
    );
}

function ComposerControls({
    compact,
    reasoningMode,
    reasoningSupported,
    onReasoningModeChange,
    config,
    selectedModel,
    permissionMode,
    theme,
    onModelChange,
    onPermissionChange,
    skillsOpen,
    onSkillsOpenChange,
    selectedSkillCount,
}: {
    compact: boolean;
    reasoningMode: AgentReasoningMode;
    reasoningSupported: boolean;
    onReasoningModeChange: (value: AgentReasoningMode) => void;
    config: ReturnType<typeof useEffectiveConfig>;
    selectedModel: string;
    permissionMode: AgentPermissionMode;
    theme: CanvasTheme;
    onModelChange: (model: string) => void;
    onPermissionChange: (mode: AgentPermissionMode) => void;
    skillsOpen: boolean;
    onSkillsOpenChange: (open: boolean) => void;
    selectedSkillCount: number;
}) {
    const permissionVisual = agentPermissionVisual(permissionMode);
    return (
        <div className={cn("agent-composer-settings flex min-w-0 flex-wrap items-center gap-0.5", compact && "flex-nowrap") }>
            <ModelPicker
                config={config}
                value={selectedModel}
                capability="text"
                onChange={onModelChange}
                variant="creation"
                className={cn("!h-8 !min-w-0 !max-w-full !border-0 !bg-transparent !px-1.5 !shadow-none", compact ? "!w-8 !px-0" : "!w-36")}
                popoverClassName="agent-model-picker-popover"


                placeholder="选择文本模型"
            />
            {reasoningSupported ? <Dropdown trigger={["click"]} placement="topLeft" menu={{ items: reasoningMenuItems(reasoningMode, onReasoningModeChange) }}>
                <button type="button" aria-label="选择 Agent 推理模式" title="推理模式：只用于规划和工具选择" className={cn("flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25", compact && "w-8 justify-center px-0")} style={{ color: reasoningMode === "off" ? theme.node.muted : theme.accent.primary, background: reasoningMode === "off" ? "transparent" : theme.node.fill }}>
                    <Sparkles className="size-3.5" />{compact ? <span className="sr-only">{reasoningModeLabel(reasoningMode)}</span> : reasoningModeLabel(reasoningMode)}
                </button>
            </Dropdown> : null}
            <Dropdown trigger={["click"]} placement="topLeft" menu={{ items: agentPermissionMenuItems(permissionMode, onPermissionChange) }}>
                <button
                    type="button"
                    className={cn("flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25", compact && "w-8 justify-center px-0")}
                    style={{ color: theme.node.muted, background: "transparent" }}
                    aria-label="选择 Agent 执行权限"
                >
                    <ShieldCheck className="size-3.5" style={{ color: permissionVisual.color }} />
                    {compact ? <span className="sr-only">{agentPermissionLabel(permissionMode)}</span> : <span className="max-w-20 truncate">{agentPermissionLabel(permissionMode)}</span>}
                </button>
            </Dropdown>
            <button
                type="button"
                className={cn("flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25", compact && "w-8 justify-center px-0")}
                style={{ color: selectedSkillCount ? theme.accent.primary : theme.node.muted, background: skillsOpen ? theme.node.fill : "transparent" }}
                aria-label={`打开 Skills 技能库${selectedSkillCount ? `，已启用 ${selectedSkillCount} 个` : ""}`}
                aria-expanded={skillsOpen}
                aria-haspopup="dialog"
                title="打开 Skills 技能库"
                onClick={() => onSkillsOpenChange(true)}
            >
                <Sparkles className="size-3.5" />
                {compact ? <span className="sr-only">Skills技能包({selectedSkillCount})</span> : <span className="max-w-28 truncate">Skills技能包({selectedSkillCount})</span>}
            </button>
        </div>
    );
}

const reasoningLabels: Record<AgentReasoningMode, string> = { off: "直达", auto: "自动推理", deep: "深入推理" };

function reasoningModeLabel(mode: AgentReasoningMode) { return reasoningLabels[mode]; }

function reasoningMenuItems(mode: AgentReasoningMode, onChange: (value: AgentReasoningMode) => void) {
    return (Object.keys(reasoningLabels) as AgentReasoningMode[]).map((value) => ({
        key: value,
        label: reasoningLabels[value],
        icon: value === mode ? <Check className="size-3.5" /> : undefined,
        onClick: () => onChange(value),
    }));
}

function ApprovalCard({ approval, theme, submitting, onFocusNode, onReasonChange, onApprove, onReject }: { approval: ApprovalState; theme: CanvasTheme; submitting: boolean; onFocusNode?: (nodeId: string) => void; onReasonChange: (value: string) => void; onApprove: (settings?: AgentMediaSettings) => void; onReject: () => void }) {
    const [showReason, setShowReason] = useState(Boolean(approval.reason));
    const [mediaSettings, setMediaSettings] = useState<AgentMediaSettings>();
    const imageApproval = agentImageApproval(approval.detail);
    const action = agentApprovalPresentation(approval.detail);
    return (
        <section className="canvas-agent-approval-card" aria-label={action.title}>
            <div className="canvas-agent-approval-header">
                <span className="canvas-agent-approval-icon" aria-hidden="true"><ShieldCheck className="size-4" /></span>
                <h3>{action.title}</h3>
                <span className="canvas-agent-approval-badge">等待你的确认</span>
            </div>
            <p className="canvas-agent-approval-description" style={{ color: theme.node.muted }}>{action.description}</p>
            {action.items.length ? (
                <div className="canvas-agent-approval-items" aria-label="涉及节点">
                    {action.items.map((item, index) => <ApprovalPreviewItemView key={`${item.operation}-${item.nodeId || item.nodeTitle || index}-${index}`} item={imageApproval ? { ...item, details: item.details?.filter((detail) => !/^(模型|画幅|质量)[：:]/.test(detail)) } : item} theme={theme} onFocusNode={onFocusNode} />)}
                </div>
            ) : <div className="canvas-agent-approval-empty" style={{ color: theme.node.muted }}>无法确认具体目标，继续前请重新读取画布。</div>}
            {imageApproval ? <CanvasAgentImageApprovalSettings initial={imageApproval} value={mediaSettings} onChange={setMediaSettings} theme={theme} disabled={submitting} /> : null}
            <button type="button" className="canvas-agent-approval-reason-toggle" aria-expanded={showReason} onClick={() => setShowReason((value) => !value)} disabled={submitting}>
                {showReason ? "收起拒绝理由" : "填写拒绝理由（可选）"}
            </button>
            {showReason ? <Input.TextArea className="canvas-agent-approval-reason" value={approval.reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="告诉 Agent 为什么暂不执行" autoSize={{ minRows: 2, maxRows: 3 }} maxLength={2000} disabled={submitting} /> : null}
            <div className="canvas-agent-approval-actions">
                <button type="button" className="canvas-agent-approval-reject" disabled={submitting} onClick={onReject}>暂不执行</button>
                <button type="button" className="canvas-agent-approval-approve" disabled={submitting} onClick={() => onApprove(mediaSettings)}>
                    {submitting ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                    {submitting ? "正在提交" : "同意执行"}
                </button>
            </div>
        </section>
    );
}

function ApprovalPreviewItemView({ item, theme, onFocusNode }: { item: ReturnType<typeof agentApprovalPresentation>["items"][number]; theme: CanvasTheme; onFocusNode?: (nodeId: string) => void }) {
    const operationLabel = item.operation === "add_node" ? "新增" : item.operation === "update_node" ? "修改" : item.operation === "connect_nodes" ? "连线" : item.operation === "create_storyboard" ? "创建分镜" : item.operation === "edit_storyboard" ? "修改分镜" : item.operation === "plan_step" ? "计划" : "生成";
    const renderNode = (title: string | undefined, id: string | undefined, typeLabel: string | undefined, role: "source" | "target" | "node") => {
        if (!title) return null;
        const content = <><span className="canvas-agent-approval-node-title">{title}</span>{typeLabel ? <span className="canvas-agent-approval-node-type">{typeLabel}</span> : null}</>;
        return id && onFocusNode ? <button type="button" className="canvas-agent-approval-node canvas-agent-approval-node-button" onClick={() => onFocusNode(id)} title="定位到画布节点">{content}</button> : <span className={`canvas-agent-approval-node canvas-agent-approval-node-${role}`}>{content}</span>;
    };
    return (
        <article className="canvas-agent-approval-item">
            <div className="canvas-agent-approval-item-main">
                <span className={`canvas-agent-approval-operation canvas-agent-approval-operation-${item.operation}`}>{operationLabel}</span>
                {item.operation === "connect_nodes" ? (
                    <div className="canvas-agent-approval-connection">
                        {renderNode(item.nodeTitle, item.nodeId, item.nodeTypeLabel, "source")}
                        <span className="canvas-agent-approval-arrow" aria-hidden="true">→</span>
                        {renderNode(item.targetNodeTitle, item.targetNodeId, undefined, "target")}
                    </div>
                ) : (
                    <div className="canvas-agent-approval-node-summary">
                        {renderNode(item.nodeTitle, item.nodeId, item.nodeTypeLabel, "node")}
                        {item.resultTitle ? <><span className="canvas-agent-approval-change-arrow" aria-hidden="true">改为</span><span className="canvas-agent-approval-result-title">《{item.resultTitle}》</span></> : null}
                    </div>
                )}
            </div>
            {item.fields?.length ? <div className="canvas-agent-approval-field-list">修改：{item.fields.map((field) => <span key={field}>{field}</span>)}</div> : null}
            {item.details?.length ? <div className="canvas-agent-approval-detail-list">{item.details.map((detail) => <span key={detail}>{detail}</span>)}</div> : null}
            <div className="canvas-agent-approval-summary">{item.summary}</div>
        </article>
    );
}

function truncateConversationPreview(value: string, max = 96) {
    const compact = markdownPlainText(value);
    return compact.length > max ? `${compact.slice(0, max)}…` : compact || "尚未发送消息";
}

function formatConversationTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
function applyAgentEvent(event: AgentEvent, setMessages: Dispatch<SetStateAction<CloudAgentChatMessage[]>>, setRun: Dispatch<SetStateAction<AgentRun | null>>, setApproval: Dispatch<SetStateAction<ApprovalState | null>>, setPrompt?: Dispatch<SetStateAction<string>>) {
    const payload = event.payload || {};
    const text = String(payload.text || payload.summary || payload.message || "");
    if (event.type === "run_status") {
        const snapshotApproval = payload.approval && typeof payload.approval === "object" ? payload.approval as AgentRun["approval"] : undefined;
        setRun((current) => (current ? { ...current, status: String(payload.status || current.status) as AgentRun["status"], updatedAt: event.createdAt, revision: Number(payload.revision || 0), cleanupPending: Boolean(payload.cleanupPending), failureMessage: String(payload.failureMessage || ""), skills: payload.skills as AgentRun["skills"], step: Number(payload.step || 0), approval: snapshotApproval } : current));
        if (payload.failureMessage) setMessages((current) => appendAgentError(current, `terminal-${event.runId}`, String(payload.failureMessage)));
        if (snapshotApproval && !snapshotApproval.decision && snapshotApproval.approvalId) {
            setApproval((current) => ({ approvalId: snapshotApproval.approvalId, detail: snapshotApproval, reason: current?.approvalId === snapshotApproval.approvalId ? current.reason : snapshotApproval.reason || "" }));
        } else {
            setApproval(null);
        }
        return;
    }
    if (event.type === "approval_decided") {
        setApproval(null);
        if (payload.decision === "reject") {
            setMessages((current) => appendUniqueMessage(current, {
                id: event.eventId,
                role: "system",
                text: text || "已拒绝本次操作，未写入画布。你可以告诉 Agent 修改方向后重新申请。",
            }));
        }
        return;
    }
    if (event.type === "progress_summary") {
        setMessages((current) => appendUniqueMessage(current, { id: event.eventId, role: "system", text: text || "Agent 正在整理执行计划" }));
        return;
    }
    if (event.type === "assistant_delta") {
        setMessages((current) => upsertTextMessage(current, String(payload.messageId || "assistant"), text, true));
        return;
    }
    if (event.type === "reasoning_delta" || event.type === "reasoning_message") {
        const id = String(payload.messageId || `${event.runId}:reasoning`);
        setMessages((current) => upsertTextMessage(current, id, text, event.type === "reasoning_delta")
            .map((item) => item.id === id ? { ...item, reasoning: true } : item));
        return;
    }
    if (event.type === "plan_updated" && Array.isArray(payload.items)) {
        const id = `plan-${event.runId}`;
        const planItems = payload.items as CloudAgentPlanItem[];
        setMessages((current) => {
            const index = current.findIndex((entry) => entry.id === id);
            const message: CloudAgentChatMessage = { id, role: "tool", text: "", planItems };
            if (index < 0) return [...current, message];
            const next = [...current];
            next[index] = message;
            return next;
        });
        return;
    }
    if (event.type === "user_interjection") {
        if (!text) return;
        setMessages((current) => appendUniqueMessage(current, { id: String(payload.messageId || event.eventId), role: "user", text, interjection: "sent" }));
        return;
    }
    if (event.type === "user_interjection_dropped") {
        const messageId = String(payload.messageId || event.eventId);
        const reason = String(payload.reason || "本轮已结束");
        setMessages((current) => {
            const marked = current.map((item) => item.id === messageId ? { ...item, interjection: "undelivered" as const } : item);
            return appendUniqueMessage(marked, { id: `interjection-dropped-${messageId}`, role: "system", text: `${reason}，这条插话没有送到模型。需要的话重新发一次，它会作为新一轮。` });
        });
        setPrompt?.((current) => (current.trim() ? current : text));
        return;
    }
    if (event.type === "user_question") {
        const options = Array.isArray(payload.options)
            ? (payload.options as Array<{ label?: unknown; detail?: unknown }>)
                .map((option) => ({ label: String(option?.label || "").trim(), detail: option?.detail === undefined ? undefined : String(option.detail) }))
                .filter((option) => option.label)
            : [];
        const question = String(payload.question || "").trim();
        if (!question || options.length < 2) return;
        const id = `question-${event.runId}:${event.seq ?? event.eventId}`;
        setMessages((current) => appendUniqueMessage(current, {
            id,
            role: "assistant",
            text: "",
            question: { question, options, allowFreeform: payload.allowFreeform !== false },
        }));
        return;
    }
    if (event.type === "assistant_message") {
        setMessages((current) => upsertTextMessage(current, String(payload.messageId || event.eventId), text, false));
        return;
    }
    if (event.type === "assistant_snapshot") {
        setMessages((current) => upsertTextMessage(current, String(payload.messageId || event.eventId), text, false));
        return;
    }
    if (event.type === "approval_requested") {
        const approvalId = String(payload.approvalId || "");
        setApproval((current) => ({ approvalId, detail: payload, reason: current?.approvalId === approvalId ? current.reason : "" }));
        return;
    }
    if (event.type === "canvas_updated" && Array.isArray(payload.actions)) {
        if (payload.operation === "generate_media_submit" || payload.operation === "generate_media_complete") return;
        const { canvasPatch: _patch, ...detail } = payload;
        const id = payload.callId ? `canvas-${event.runId}-${payload.callId}` : event.eventId;
        setMessages((current) => appendUniqueMessage(current, { id, role: "tool", title: "canvas_apply_ops", text: "画布操作已完成", detail: { ...detail, eventType: event.type } }));
        return;
    }
    if (event.type === "tool_completed" && payload.toolName === "canvas_apply_ops" && payload.callId) {
        const id = `canvas-${event.runId}-${payload.callId}`;
        setMessages((current) => appendUniqueMessage(current, { id, role: "tool", title: "canvas_apply_ops", text: text || "画布操作已完成", detail: { ...payload, eventType: event.type } }));
        return;
    }
    if (event.type === "generation_task_created") {
        const message: CloudAgentChatMessage = { id: event.eventId, role: "tool", title: "generate_media", text: text || event.type, detail: { ...payload, eventType: event.type } };
        setMessages((current) => upsertMediaToolTrace(current, message));
        return;
    }
    if (event.type.startsWith("tool_")) {
        const message: CloudAgentChatMessage = { id: event.eventId, role: "tool", title: String(payload.toolName || payload.title || "工具执行"), text: text || event.type, detail: { ...payload, eventType: event.type } };
        if (payload.toolName === "generate_media") {
            setMessages((current) => upsertMediaToolTrace(current, message));
        } else {
            setMessages((current) => appendUniqueMessage(current, message));
        }
        return;
    }
    if (event.type === "run_failed" || event.type === "error") setMessages((current) => appendAgentError(current, event.eventId, text || "Agent 执行失败"));
}
function toolDetailRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toolDetailNodeIds(detail: unknown): Set<string> {
    const payload = toolDetailRecord(detail);
    const ids = new Set<string>();
    for (const value of [payload.nodeId, toolDetailRecord(payload.result).nodeId]) {
        if (typeof value === "string" && value) ids.add(value);
    }
    if (Array.isArray(payload.actions)) {
        for (const action of payload.actions) {
            const nodeId = toolDetailRecord(action).nodeId;
            if (typeof nodeId === "string" && nodeId) ids.add(nodeId);
        }
    }
    if (typeof payload.arguments === "string") {
        try {
            const args = toolDetailRecord(JSON.parse(payload.arguments));
            if (Array.isArray(args.ops)) {
                for (const op of args.ops) {
                    const nodeId = toolDetailRecord(op).id;
                    if (typeof nodeId === "string" && nodeId) ids.add(nodeId);
                }
            }
        } catch {
            // Tool arguments are diagnostic data; a malformed value must not break the event feed.
        }
    }
    return ids;
}

function toolDetailTaskIds(detail: unknown): Set<string> {
    const payload = toolDetailRecord(detail);
    const ids = new Set<string>();
    for (const value of [payload.taskId, toolDetailRecord(payload.result).taskId]) {
        if (typeof value === "string" && value) ids.add(value);
    }
    return ids;
}

function mergeToolDetails(previous: unknown, next: unknown): Record<string, unknown> {
    const previousDetail = toolDetailRecord(previous);
    const nextDetail = toolDetailRecord(next);
    return {
        ...previousDetail,
        ...nextDetail,
        actions: Array.isArray(nextDetail.actions) ? nextDetail.actions : previousDetail.actions,
        arguments: nextDetail.arguments || previousDetail.arguments,
    };
}

function upsertMediaToolTrace(current: CloudAgentChatMessage[], message: CloudAgentChatMessage): CloudAgentChatMessage[] {
    const nextNodeIds = toolDetailNodeIds(message.detail);
    const nextTaskIds = toolDetailTaskIds(message.detail);
    const index = current.findIndex((item) => {
        if (item.role !== "tool") return false;
        const itemToolName = item.title || "";
        if (itemToolName !== "canvas_apply_ops" && itemToolName !== "generate_media") return false;
        const itemNodeIds = toolDetailNodeIds(item.detail);
        const itemTaskIds = toolDetailTaskIds(item.detail);
        return [...nextNodeIds].some((id) => itemNodeIds.has(id)) || [...nextTaskIds].some((id) => itemTaskIds.has(id));
    });
    if (index < 0) return appendUniqueMessage(current, message);
    const next = [...current];
    const previous = next[index];
    next[index] = {
        ...previous,
        ...message,
        id: previous.id,
        detail: mergeToolDetails(previous.detail, message.detail),
    };
    return next;
}

function appendUniqueMessage(current: CloudAgentChatMessage[], message: CloudAgentChatMessage) {
    return current.some((item) => item.id === message.id) ? current : [...current, message];
}
function upsertTextMessage(current: CloudAgentChatMessage[], id: string, text: string, append: boolean): CloudAgentChatMessage[] {
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) return [...current, { id, role: "assistant" as const, text, streaming: append }];
    if (!append && current[index].text === text && !current[index].streaming) return current;
    const next = [...current];
    next[index] = { ...next[index], text: append ? `${next[index].text}${text}` : text, streaming: append };
    return next;
}

function appendAgentError(current: CloudAgentChatMessage[], id: string, cause: unknown, fallback?: string) {
    const message = agentErrorPresentation(cause, fallback);
    const last = current.at(-1);
    if (last?.role === "error" && last.title === message.title && last.text === message.text) return current;
    return appendUniqueMessage(current, { id, role: "error", ...message });
}

function isNotFoundError(cause: unknown) {
    if (!cause || typeof cause !== "object") return false;
    const status = "status" in cause ? (cause as { status?: unknown }).status : undefined;
    return status === 404 || (cause instanceof Error && /\(404\)/u.test(cause.message));
}
