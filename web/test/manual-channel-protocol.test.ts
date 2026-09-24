import { describe, expect, test } from "bun:test";

import { defaultProtocolForModel, ensureModelProfilesWithUiDefaults, inferProtocolCapabilityFromModel } from "@/lib/model-protocols";
import { createModelChannel, defaultConfig, resolveModelRequestConfig } from "@/stores/use-config-store";

describe("manual channel protocol defaults", () => {
    test("typed gpt-4.1-mini uses the same Chat Completions default the settings radio shows", () => {
        expect(inferProtocolCapabilityFromModel("gpt-4.1-mini")).toBe("text");
        expect(defaultProtocolForModel("gpt-4.1-mini")).toBe("chat-completion");

        const channel = createModelChannel({
            id: "manual",
            name: "QA故障回归",
            baseUrl: "https://qa-beeftv.invalid/v1",
            apiKey: "fakekey",
            apiFormat: "openai",
            models: ["gpt-4.1-mini"],
        });
        const config = {
            ...defaultConfig,
            channels: [channel],
            model: "manual::gpt-4.1-mini",
            textModel: "manual::gpt-4.1-mini",
            models: ["manual::gpt-4.1-mini"],
            textModels: ["manual::gpt-4.1-mini"],
        };
        const resolved = resolveModelRequestConfig(config, config.textModel);
        expect(resolved.channelId).toBe("");
        expect(resolved.interfaceType).toBe("chat-completion");
        expect(resolved.model).toBe("gpt-4.1-mini");
    });

    test("adding a typed model persists the UI default without overwriting an explicit protocol", () => {
        const existing = [{ model: "kept-response", capability: "text" as const, protocol: "openai-response" as const }];
        const profiles = ensureModelProfilesWithUiDefaults(["kept-response", "gpt-4.1-mini"], existing);
        expect(profiles).toEqual([
            expect.objectContaining({ model: "kept-response", protocol: "openai-response" }),
            expect.objectContaining({ model: "gpt-4.1-mini", capability: "text", protocol: "chat-completion" }),
        ]);
    });
});
