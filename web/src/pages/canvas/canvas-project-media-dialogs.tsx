import { useEffect, useState } from "react";

import { CanvasNodeAnnotationDialog } from "@/components/canvas/canvas-node-annotation-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import type { CanvasNodeData } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import { resolveImageUrl } from "@/services/image-storage";

type CanvasProjectMediaDialogsProps = {
    cropNode: CanvasNodeData | null;
    annotationNode: CanvasNodeData | null;
    maskEditNode: CanvasNodeData | null;
    upscaleNode: CanvasNodeData | null;
    onCloseCrop: () => void;
    onCloseAnnotation: () => void;
    onCloseMaskEdit: () => void;
    onCloseUpscale: () => void;
    onCrop: (node: CanvasNodeData, crop: CanvasImageCropRect) => void;
    onAnnotate: (node: CanvasNodeData, dataUrl: string) => void;
    onMaskEdit: (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => void;
    onUpscale: (node: CanvasNodeData, params: CanvasImageUpscaleParams) => void;
    config: AiConfig;
};

export function CanvasProjectMediaDialogs({
    cropNode,
    annotationNode,
    maskEditNode,
    upscaleNode,
    onCloseCrop,
    onCloseAnnotation,
    onCloseMaskEdit,
    onCloseUpscale,
    onCrop,
    onAnnotate,
    onMaskEdit,
    onUpscale,
    config,
}: CanvasProjectMediaDialogsProps) {
    const cropImageUrl = useResolvedCanvasImageUrl(cropNode);
    const annotationImageUrl = useResolvedCanvasImageUrl(annotationNode);
    const maskEditImageUrl = useResolvedCanvasImageUrl(maskEditNode);
    const upscaleImageUrl = useResolvedCanvasImageUrl(upscaleNode);

    return (
        <>
            {cropNode && cropImageUrl ? <CanvasNodeCropDialog dataUrl={cropImageUrl} open onClose={onCloseCrop} onConfirm={(crop) => onCrop(cropNode, crop)} /> : null}
            {annotationNode && annotationImageUrl ? <CanvasNodeAnnotationDialog image={{ url: annotationImageUrl, storageKey: annotationNode.metadata?.storageKey }} open onClose={onCloseAnnotation} onConfirm={(dataUrl) => onAnnotate(annotationNode, dataUrl)} /> : null}
            {maskEditNode && maskEditImageUrl ? <CanvasNodeMaskEditDialog dataUrl={maskEditImageUrl} config={{ ...config, model: maskEditNode.metadata?.model || config.model, imageModel: maskEditNode.metadata?.model || config.imageModel, size: maskEditNode.metadata?.size || config.size, quality: maskEditNode.metadata?.quality || config.quality, count: String(maskEditNode.metadata?.count || config.count) }} open onClose={onCloseMaskEdit} onConfirm={(payload) => onMaskEdit(maskEditNode, payload)} /> : null}
            {upscaleNode && upscaleImageUrl ? <CanvasNodeUpscaleDialog dataUrl={upscaleImageUrl} open onClose={onCloseUpscale} onConfirm={(params) => onUpscale(upscaleNode, params)} /> : null}
        </>
    );
}

function useResolvedCanvasImageUrl(node: CanvasNodeData | null) {
    const storageKey = node?.metadata?.storageKey || "";
    const content = node?.metadata?.content || "";
    const [url, setUrl] = useState("");

    useEffect(() => {
        let active = true;
        setUrl("");
        if (!storageKey) {
            setUrl(content);
            return () => {
                active = false;
            };
        }

        void resolveImageUrl(storageKey, content, { cacheMiss: true }).then((resolved) => {
            if (active) setUrl(resolved || content);
        }).catch(() => {
            if (active) setUrl(content);
        });
        return () => {
            active = false;
        };
    }, [content, storageKey]);

    return url;
}
