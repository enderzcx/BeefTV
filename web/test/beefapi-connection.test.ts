import { expect, test } from "bun:test";
import { beefAPIConnectionLabel, type BeefAPIConnectionSummary } from "../src/services/api/beefapi-connection";

test("connection labels stay user-facing and distinct", () => {
    const cases: Array<[BeefAPIConnectionSummary, string]> = [
        [{ state: "disconnected", hasCredential: false }, "未连接"],
        [{ state: "pending", userCode: "WXYZ-1234", hasCredential: false }, "请在浏览器中确认 WXYZ-1234"],
        [{ state: "connected", account: { id: "1", display_name: "工作室" }, hasCredential: true }, "已连接 工作室"],
        [{ state: "connected", account: { id: "1", display_name: "工作室" }, balance: "zero", hasCredential: true }, "已连接 工作室，余额为 0"],
        [{ state: "expired", hasCredential: false }, "授权已过期，请重新连接"],
        [{ state: "cancelled", hasCredential: false }, "已取消本次连接"],
        [{ state: "rejected", hasCredential: false }, "授权被拒绝"],
        [{ state: "store_error", hasCredential: false }, "保存连接失败，请重试"],
        [{ state: "catalog_failed", hasCredential: true }, "模型列表读取失败，请重试"],
        [{ state: "revoked", hasCredential: true }, "连接已失效，请重新连接"],
    ];
    for (const [summary, label] of cases) {
        expect(beefAPIConnectionLabel(summary)).toBe(label);
    }
});
