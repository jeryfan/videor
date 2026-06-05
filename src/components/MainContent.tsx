import React, { useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { UrlInputBar } from "@/components/UrlInputBar";
import { CurlImportDialog } from "@/components/CurlImportDialog";
import { VideoPreview } from "@/components/download/VideoPreview";
import { BilibiliVideoList } from "@/components/download/BilibiliVideoList";
import { M3u8CandidateList } from "@/components/download/M3u8CandidateList";
import { BilibiliLoginPrompt } from "@/components/download/BilibiliLoginPrompt";
import type { VideoSource } from "@/types/download";
import type { useVideoParser } from "@/hooks/useVideoParser";
import type { useBilibiliAuth } from "@/hooks/useBilibiliAuth";
import type { useDownloadManager } from "@/hooks/useDownloadManager";
import type { CurlImportEntry } from "@/lib/curlImport";
import { getMatchedCurlEntry } from "@/lib/curlImport";

interface MainContentProps {
  activeSource: VideoSource;
  downloadUrl: string;
  onDownloadUrlChange: (value: string) => void;
  isCurlDialogOpen: boolean;
  setIsCurlDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  curlImports: CurlImportEntry[];
  setCurlImports: (v: CurlImportEntry[]) => void;
  parser: ReturnType<typeof useVideoParser>;
  bilibiliAuth: ReturnType<typeof useBilibiliAuth>;
  dm: ReturnType<typeof useDownloadManager>;
  onStartDownload: () => void;
  onStartBilibiliBatchDownload: () => void;
  onSelectM3u8Candidate: (url: string) => void;
}

export function MainContent({
  activeSource,
  downloadUrl,
  onDownloadUrlChange,
  isCurlDialogOpen,
  setIsCurlDialogOpen,
  curlImports,
  setCurlImports,
  parser,
  bilibiliAuth,
  dm,
  onStartDownload,
  onStartBilibiliBatchDownload,
  onSelectM3u8Candidate,
}: MainContentProps) {
  const { t } = useTranslation();
  const inputWrapRef = useRef<HTMLDivElement>(null);

  const downloadPlaceholder = useMemo(() => {
    const map: Record<VideoSource, string> = {
      douyin: t("video.placeholders.douyin"),
      bilibili: t("video.placeholders.bilibili"),
      m3u8: t("video.placeholders.m3u8"),
      other: t("video.placeholders.other"),
    };
    return map[activeSource];
  }, [activeSource, t]);

  const matchedCurlEntry = getMatchedCurlEntry(downloadUrl, curlImports);

  const videoPlatformLabel = useMemo(() => {
    if (parser.videoPlatform === "douyin") return t("video.sources.douyin");
    if (parser.videoPlatform === "bilibili") return t("video.sources.bilibili");
    if (parser.videoPlatform) return t("video.sources.direct");
    return "";
  }, [parser.videoPlatform, t]);

  const previewVideoUrl = useMemo(() => {
    const format = parser.videoFormats[parser.selectedFormatIdx];
    if (!format) return "";
    if (format.preview_url) return format.preview_url;
    if (parser.videoPlatform === "bilibili" && format.url) {
      return `videor-stream://localhost/video?url=${encodeURIComponent(format.url)}`;
    }
    return format.url ?? "";
  }, [parser.videoFormats, parser.selectedFormatIdx, parser.videoPlatform]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        void parser.parse(downloadUrl, activeSource, curlImports);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        if (
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA"
        ) {
          e.preventDefault();
          const input = inputWrapRef.current?.querySelector("input");
          if (input) {
            input.focus();
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        if (
          parser.parseStatus === "success" &&
          activeSource === "bilibili" &&
          parser.videoItems.length > 0 &&
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA"
        ) {
          e.preventDefault();
          parser.setSelectedVideoItems(
            parser.videoItems.map((item) => item.id),
          );
        }
      }
    },
    [parser, downloadUrl, activeSource, curlImports],
  );

  return (
    <div className="w-full max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl">
      <UrlInputBar
        ref={inputWrapRef}
        downloadUrl={downloadUrl}
        onChange={onDownloadUrlChange}
        onKeyDown={handleKeyDown}
        placeholder={t(`download.urlPlaceholder.${activeSource}`, {
          defaultValue: downloadPlaceholder,
        })}
        isCurlDialogOpen={isCurlDialogOpen}
        onToggleCurlDialog={() => setIsCurlDialogOpen((v) => !v)}
        matchedCurlEntry={matchedCurlEntry}
      />

      <CurlImportDialog
        open={isCurlDialogOpen}
        onOpenChange={setIsCurlDialogOpen}
        curlImports={curlImports}
        onCurlImportsChange={setCurlImports}
        downloadUrl={downloadUrl}
        onFillUrl={(url) => onDownloadUrlChange(url)}
      />

      {parser.parseStatus === "parsing" && (
        <div className="flex items-center justify-center gap-2 py-2 animate-fade-in">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">
            {t("video.parsing")}
          </span>
        </div>
      )}

      {parser.parseStatus === "success" &&
        activeSource === "bilibili" &&
        (parser.videoLoginRequired || parser.videoMessage) &&
        parser.videoFormats.length === 0 && (
          <BilibiliLoginPrompt
            videoKind={parser.videoKind}
            videoMessage={parser.videoMessage}
            onLogin={bilibiliAuth.handleOpenBilibiliLogin}
          />
        )}

      {parser.parseStatus === "success" &&
        activeSource === "bilibili" &&
        parser.videoItems.length > 0 && (
          <BilibiliVideoList
            videoTitle={parser.videoTitle}
            videoKind={parser.videoKind}
            videoItems={parser.videoItems}
            selectedVideoItems={parser.selectedVideoItems}
            bilibiliStatus={bilibiliAuth.bilibiliStatus}
            activeBatchCount={dm.activeBatchCount}
            onToggleSelectAll={() =>
              parser.setSelectedVideoItems(
                parser.selectedVideoItems.length ===
                  parser.videoItems.length
                  ? []
                  : parser.videoItems.map((item) => item.id),
              )
            }
            onSelectItem={(itemId, checked) =>
              parser.setSelectedVideoItems((prev) =>
                checked
                  ? Array.from(new Set([...prev, itemId]))
                  : prev.filter((id) => id !== itemId),
              )
            }
            onStartBatch={() => void onStartBilibiliBatchDownload()}
          />
        )}

      {parser.parseStatus === "success" &&
        activeSource === "m3u8" &&
        parser.videoItems.length > 0 &&
        parser.videoFormats.length === 0 && (
          <M3u8CandidateList
            videoTitle={parser.videoTitle}
            videoMessage={parser.videoMessage}
            videoItems={parser.videoItems}
            onSelectCandidate={onSelectM3u8Candidate}
          />
        )}

      {parser.parseStatus === "success" &&
        parser.videoFormats.length > 0 && (
          <VideoPreview
            videoRef={parser.previewVideoRef}
            previewUrl={previewVideoUrl}
            videoCover={parser.videoCover}
            videoTitle={parser.videoTitle}
            videoPlatformLabel={videoPlatformLabel}
            videoFormats={parser.videoFormats}
            selectedFormatIdx={parser.selectedFormatIdx}
            onFormatChange={parser.setSelectedFormatIdx}
            downloadTaskId={dm.downloadTaskId}
            onStartDownload={onStartDownload}
            downloadError={dm.downloadError}
            onVideoError={parser.closeCurrentVideo}
          />
        )}

      {parser.parseStatus === "error" && (
        <div className="text-center text-sm text-destructive py-2">
          {t("video.parsingFailed")}
        </div>
      )}
    </div>
  );
}
