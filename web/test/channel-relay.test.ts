import { afterEach, expect, test } from "bun:test";

import { channelRequest } from "../src/services/api/custom-channel-relay";

const originalWindow = globalThis.window;

afterEach(() => {
    if (originalWindow) globalThis.window = originalWindow;
    else Reflect.deleteProperty(globalThis, "window");
});

test("Wails custom channels call the configured upstream directly", () => {
    const wailsWindow = new EventTarget();
    Object.defineProperty(wailsWindow, "location", {
        configurable: true,
        value: { protocol: "wails:" },
    });
    globalThis.window = wailsWindow as Window & typeof globalThis;

    const request = channelRequest(
        {
            baseUrl: "https://enterprise.beefapi.com",
            apiKey: "synthetic-key",
            apiFormat: "openai",
            headers: [{ name: "X-Test", value: "desktop" }],
        },
        "https://enterprise.beefapi.com/v1/models",
        { Accept: "application/json" },
    );

    expect(request.url).toBe("https://enterprise.beefapi.com/v1/models");
    expect(request.credentials).toBe("omit");
    expect(request.headers.authorization).toBe("Bearer synthetic-key");
    expect(request.headers["x-test"]).toBe("desktop");
    expect(request.headers["x-canvas-upstream-url"]).toBeUndefined();
});
