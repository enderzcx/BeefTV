import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");

describe("local asset folders", () => {
    test("keeps folder CRUD and moves local when remote mode is disabled", () => {
        expect(source).toContain('const LOCAL_ASSET_FOLDERS_KEY = "infinite-canvas:asset-folders";');
        expect(source).toContain('const folders = remoteMode ? foldersQuery.data?.folders || [] : localFolders;');
        expect(source).toContain('if (remoteMode) await moveAssetsToFolder');
        expect(source).toContain('else await persistLocalFolders(localFolders.filter((item) => item.id !== folder.id));');
        expect(source).toContain('await localForageStorageForScope().setItem(LOCAL_ASSET_FOLDERS_KEY, JSON.stringify(next));');
    });
});
