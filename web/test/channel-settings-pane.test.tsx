import { expect, test } from "bun:test";
import { modelConfigChannelPresentation, modelConfigChannelStatusLabel } from "../src/pages/settings/channel-settings-pane";
import { createModelChannel } from "../src/stores/use-config-store";

test("pinned BeefAPI is visible and cannot be deleted before models are fetched", () => {
    const channel = createModelChannel({
        id: "beefapi", name: "BeefAPI", baseUrl: "https://enterprise.beefapi.com",
        apiKey: "", models: [], pinned: true, presetVersion: 1,
    });
    expect(modelConfigChannelPresentation(channel)).toEqual({ builtin: true, deletable: false, adapterLabel: "应用内置适配 · v1" });
    expect(modelConfigChannelStatusLabel(channel, { status: "idle", revision: 0, dirty: false, error: "" })).toBe("待配置");
});

test("BeefAPI status copy reflects local persistence state", () => {
    const channel = createModelChannel({ id: "beefapi", apiKey: "key", pinned: true, presetVersion: 1 });
    expect(modelConfigChannelStatusLabel(channel, { status: "saving", revision: 1, dirty: true, error: "" })).toBe("保存中");
    expect(modelConfigChannelStatusLabel(channel, { status: "saved", revision: 2, dirty: false, error: "" })).toBe("已保存");
    expect(modelConfigChannelStatusLabel(channel, { status: "error", revision: 2, dirty: true, error: "disk" })).toBe("保存失败");
    expect(modelConfigChannelStatusLabel(channel, { status: "idle", revision: 2, dirty: false, error: "" })).toBe("可用");
});
