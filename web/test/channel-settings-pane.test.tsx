import { expect, test } from "bun:test";
import { modelConfigChannelPresentation, modelConfigChannelStatusLabel, shouldReloadModelConfigForBeefAPI } from "../src/pages/settings/channel-settings-pane";
import { createModelChannel } from "../src/stores/use-config-store";

test("pinned BeefAPI is visible and cannot be deleted before models are fetched", () => {
    const channel = createModelChannel({
        id: "beefapi",
        name: "BeefAPI",
        baseUrl: "https://enterprise.beefapi.com",
        apiKey: "",
        models: [],
        pinned: true,
        presetVersion: 1,
    });
    expect(modelConfigChannelPresentation(channel)).toEqual({ builtin: true, deletable: false, adapterLabel: "应用内置适配 · v1" });
    expect(modelConfigChannelStatusLabel(channel, { status: "idle", revision: 0, dirty: false, error: "" })).toBe("未连接");
});

test("BeefAPI status copy reflects enterprise connection state", () => {
    const channel = createModelChannel({ id: "beefapi", apiKey: "", pinned: true, presetVersion: 1 });
    expect(modelConfigChannelStatusLabel(channel, { status: "idle", revision: 1, dirty: false, error: "" }, { state: "pending", userCode: "ABCD-EFGH", hasCredential: false })).toBe("请在浏览器中确认 ABCD-EFGH");
    expect(modelConfigChannelStatusLabel(channel, { status: "idle", revision: 2, dirty: false, error: "" }, { state: "connected", account: { id: "acct-1", display_name: "Ender" }, hasCredential: true })).toBe("已连接 Ender");
    expect(modelConfigChannelStatusLabel(channel, { status: "idle", revision: 2, dirty: false, error: "" }, { state: "revoked", hasCredential: true })).toBe("连接已失效，请重新连接");
});

test("BeefAPI connected transition reloads local model config", () => {
    expect(shouldReloadModelConfigForBeefAPI("pending", "connected")).toBe(true);
    expect(shouldReloadModelConfigForBeefAPI(undefined, "connected")).toBe(true);
    expect(shouldReloadModelConfigForBeefAPI("connected", "connected")).toBe(false);
    expect(shouldReloadModelConfigForBeefAPI("connected", "disconnected")).toBe(true);
    expect(shouldReloadModelConfigForBeefAPI("catalog_failed", "disconnected")).toBe(true);
    expect(shouldReloadModelConfigForBeefAPI("pending", "pending")).toBe(false);
    expect(shouldReloadModelConfigForBeefAPI(undefined, "disconnected")).toBe(false);
});
