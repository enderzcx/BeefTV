import { linkProjectAsset, moveProjectAsset, updateProjectAssetCategory } from "@/services/api/projects";
import { deleteAssetWithRemoteSync, hasRemoteUserDataSyncSession, saveRemoteUserDataNow } from "@/services/local-workspace-sync";
import { normalizeAssetCategory } from "@/lib/asset-category";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { flushAssetStorePersistence, useAssetStore, type Asset, type AssetCategory, type AssetStatus } from "@/stores/use-asset-store";

type WorkspaceAssetLinkOptions = {
    asset: Asset;
    domainProjectId?: string;
    category?: AssetCategory;
    folderId?: string;
    signal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

/** Single boundary for local asset persistence and optional project linking. */
export async function persistWorkspaceAssetLink({ asset, domainProjectId, category, folderId, signal }: WorkspaceAssetLinkOptions) {
    throwIfAborted(signal);
    // Local mode is authoritative even if a stale remote session flag is
    // still present during workspace hydration. Never let that transient
    // state route a local asset through the hosted sync boundary.
    if (isLocalWorkspaceMode() || !hasRemoteUserDataSyncSession()) {
        if (domainProjectId) {
            const projectIds = Array.isArray(asset.metadata?.projectIds) ? asset.metadata.projectIds.filter((id): id is string => typeof id === "string") : [];
            useAssetStore.getState().updateAsset(asset.id, { metadata: { ...asset.metadata, projectIds: [...new Set([...projectIds, domainProjectId])] } });
        }
        await flushAssetStorePersistence();
        return;
    }
    if (!domainProjectId) {
        await saveRemoteUserDataNow();
        throwIfAborted(signal);
        return;
    }

    await saveRemoteUserDataNow();
    throwIfAborted(signal);
    const { asset: linkedAsset } = await linkProjectAsset(domainProjectId, { assetId: asset.id, category: normalizeAssetCategory(category || asset.category), folderId }, signal);
    throwIfAborted(signal);
    let linked = category && linkedAsset.category !== category ? (await updateProjectAssetCategory(domainProjectId, asset.id, category, signal)).asset : linkedAsset;
    if (folderId !== undefined && (linked.folderId || "") !== folderId) linked = (await moveProjectAsset(domainProjectId, asset.id, folderId, signal)).asset;
    throwIfAborted(signal);
    const projectIds = Array.isArray(asset.metadata?.projectIds) ? asset.metadata.projectIds.filter((id): id is string => typeof id === "string") : [];
    useAssetStore.getState().updateAsset(asset.id, {
        category: normalizeAssetCategory(linked.category),
        status: linked.status as AssetStatus,
        primaryVersionId: linked.primaryVersionId,
        metadata: { ...asset.metadata, projectIds: [...new Set([...projectIds, domainProjectId])] },
    });
    await saveRemoteUserDataNow();
    throwIfAborted(signal);
}

export async function deleteWorkspaceAsset(id: string) {
    const assetId = id.trim();
    if (!assetId) throw new Error("素材 ID 不能为空");
    if (!isLocalWorkspaceMode()) return deleteAssetWithRemoteSync(assetId);
    await useAssetStore.getState().removeAsset(assetId);
    await flushAssetStorePersistence();
}

export async function persistWorkspaceAssetChanges() {
    await flushAssetStorePersistence();
    if (hasRemoteUserDataSyncSession()) await saveRemoteUserDataNow();
}
