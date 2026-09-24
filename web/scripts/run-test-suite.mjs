import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const testFilePattern = /\.test\.[cm]?[jt]sx?$/;
const mutatesBrowserGlobals = /globalThis\s*(?:\.\s*(?:window|document|navigator)|\[\s*["'](?:window|document|navigator)["']\s*\])|Object\.defineProperty\(\s*globalThis\s*,\s*["'](?:window|document|navigator)["']/;

function collectTestFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectTestFiles(path);
        return testFilePattern.test(entry.name) ? [relative(root, path)] : [];
    });
}

function run(files) {
    if (files.length === 0) return;
    const result = Bun.spawnSync([process.execPath, "test", ...files], {
        cwd: root,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}

const files = [...collectTestFiles(join(root, "test")), ...collectTestFiles(join(root, "src"))].sort();
const isolated = files.filter((file) => mutatesBrowserGlobals.test(readFileSync(join(root, file), "utf8")));
const shared = files.filter((file) => !isolated.includes(file));

run(shared);
for (const file of isolated) run([file]);
