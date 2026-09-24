export type AgentPanelLayout = { left: number; top: number; width: number; height: number };
export type AgentPanelViewport = { width: number; height: number };
export type AgentPanelGesture = "move" | "north" | "west" | "northwest";

export const AGENT_PANEL_LAYOUT_KEY = "canvas:agent-panel-layout:v1";
const MARGIN = 12;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function clampAgentPanelLayout(layout: AgentPanelLayout, viewport: AgentPanelViewport): AgentPanelLayout {
    const maxWidth = Math.max(1, viewport.width - MARGIN * 2);
    const maxHeight = Math.max(1, viewport.height - MARGIN * 2);
    const width = clamp(layout.width, Math.min(340, maxWidth), maxWidth);
    const height = clamp(layout.height, Math.min(420, maxHeight), maxHeight);
    return {
        width,
        height,
        left: clamp(layout.left, MARGIN, Math.max(MARGIN, viewport.width - width - MARGIN)),
        top: clamp(layout.top, MARGIN, Math.max(MARGIN, viewport.height - height - MARGIN)),
    };
}

export function restoreAgentPanelLayout(raw: string | null, viewport: AgentPanelViewport): AgentPanelLayout {
    // LibTV 默认将 Agent 停靠在右侧，窄面板优先保留画布可视区域。
    const width = Math.min(340, viewport.width);
    const fallback = { width, height: viewport.height, left: Math.max(0, viewport.width - width), top: 0 };
    if (!raw) return fallback;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && ["left", "top", "width", "height"].every((key) => typeof (parsed as Record<string, unknown>)[key] === "number" && Number.isFinite((parsed as Record<string, unknown>)[key]))) {
            const candidate = parsed as AgentPanelLayout;
            // During a route transition the browser may report a temporary
            // scrollbar-reduced viewport. Preserve an already right-docked
            // panel instead of turning that transient inset into a saved
            // floating layout.
            if (candidate.top === 0 && candidate.left + candidate.width >= viewport.width - 1) {
                const dockedWidth = Math.min(candidate.width, viewport.width);
                return { width: dockedWidth, height: viewport.height, left: Math.max(0, viewport.width - dockedWidth), top: 0 };
            }
            return clampAgentPanelLayout(candidate, viewport);
        }
    } catch {
        // UI 偏好损坏不影响对话或服务端数据，恢复可见的默认窗口。
    }
    return fallback;
}

export function changeAgentPanelLayout(start: AgentPanelLayout, gesture: AgentPanelGesture, dx: number, dy: number, viewport: AgentPanelViewport): AgentPanelLayout {
    if (gesture === "move") return clampAgentPanelLayout({ ...start, left: start.left + dx, top: start.top + dy }, viewport);
    const right = start.left + start.width;
    const bottom = start.top + start.height;
    const left = gesture === "north" ? start.left : clamp(start.left + dx, MARGIN, right - Math.min(340, start.width));
    const top = gesture === "west" ? start.top : clamp(start.top + dy, MARGIN, bottom - Math.min(420, start.height));
    return { left, top, width: right - left, height: bottom - top };
}
