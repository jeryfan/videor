import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SettingsPage } from "@/components/settings/SettingsPage";
import { cn } from "@/lib/utils";
import { useSettingsQuery } from "@/lib/query";
import { UpdateBanner } from "@/components/UpdateBanner";
import { BilibiliLoginDialog } from "@/components/download/BilibiliLoginDialog";
import { DownloadHistoryPanel } from "@/components/download/DownloadHistoryPanel";
import { WindowControls } from "@/components/WindowControls";
import { AppHeader } from "@/components/AppHeader";
import { MainContent } from "@/components/MainContent";
import { getInitialVideoSource } from "@/components/SourceSwitcher";
import { useWindowState } from "@/hooks/useWindowState";
import { useBilibiliAuth } from "@/hooks/useBilibiliAuth";
import { useDownloadManager } from "@/hooks/useDownloadManager";
import { useVideoParser } from "@/hooks/useVideoParser";
import { useCurlImports } from "@/hooks/useCurlImports";
import type { VideoSource } from "@/types/download";

function App() {
  const { t } = useTranslation();
  const { data: settingsData } = useSettingsQuery();

  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeSource, setActiveSource] = useState<VideoSource>(
    getInitialVideoSource,
  );
  const [downloadUrl, setDownloadUrl] = useState("");
  const { curlImports, setCurlImports } = useCurlImports();
  const [isCurlDialogOpen, setIsCurlDialogOpen] = useState(false);

  const parser = useVideoParser();
  const windowState = useWindowState(settingsData);
  const bilibiliAuth = useBilibiliAuth(activeSource);
  const dm = useDownloadManager(settingsData);

  const handleSourceSwitch = useCallback(
    (source: VideoSource) => {
      if (source === activeSource) return;
      parser.resetParsedVideoState();
      setDownloadUrl("");
      setActiveSource(source);
    },
    [activeSource, parser],
  );

  const handleSelectM3u8Candidate = useCallback(
    async (url: string) => {
      setDownloadUrl(url);
      await parser.parseM3u8Candidate(url, curlImports);
    },
    [parser, curlImports],
  );

  const handleStartDownload = useCallback(async () => {
    if (parser.videoFormats.length === 0 || !parser.videoTitle) {
      toast.error(t("video.infoIncomplete"));
      return;
    }
    const format = parser.videoFormats[parser.selectedFormatIdx];
    await dm.startSingleDownload({
      title: parser.videoTitle,
      format,
      source: activeSource,
      url: downloadUrl,
    });
  }, [parser, activeSource, downloadUrl, dm, t]);

  const handleStartBilibiliBatchDownload = useCallback(async () => {
    await dm.startBatchDownload({
      items: parser.videoItems,
      selectedItemIds: parser.selectedVideoItems,
      title: parser.videoTitle,
      parseIntervalMs: settingsData?.batchParseIntervalMs ?? 1500,
    });
  }, [dm, parser, settingsData]);

  return (
    <div
      className="flex flex-col h-screen overflow-hidden bg-background text-foreground selection:bg-primary/30 pb-4"
      style={{ overflowX: "hidden", paddingTop: windowState.contentTopOffset }}
    >
      {(windowState.dragBarHeight > 0 || windowState.useAppWindowControls) && (
        <div
          className="fixed top-0 left-0 right-0 z-[70] flex items-center justify-end px-2"
          data-tauri-drag-region
          style={{
            WebkitAppRegion: "drag",
            height: windowState.dragBarHeight,
          } as any}
        >
          {windowState.useAppWindowControls && (
            <div
              className="flex items-center gap-1"
              style={{ WebkitAppRegion: "no-drag" } as any}
            >
              <WindowControls
                isMaximized={windowState.isWindowMaximized}
                onMinimize={() => void windowState.handleWindowMinimize()}
                onToggleMaximize={() =>
                  void windowState.handleWindowToggleMaximize()
                }
                onClose={() => void windowState.handleWindowClose()}
              />
            </div>
          )}
        </div>
      )}

      <BilibiliLoginDialog
        open={bilibiliAuth.isBilibiliLoginOpen}
        onOpenChange={bilibiliAuth.setIsBilibiliLoginOpen}
        qrImage={bilibiliAuth.bilibiliQrImage}
        loginMessage={bilibiliAuth.bilibiliLoginMessage}
        onRefreshQr={bilibiliAuth.handleOpenBilibiliLogin}
      />

      <AppHeader
        showSettings={showSettings}
        showHistory={showHistory}
        activeSource={activeSource}
        bilibiliStatus={bilibiliAuth.bilibiliStatus}
        onBackToMain={() => {
          setShowSettings(false);
          setShowHistory(false);
        }}
        onShowSettings={() => setShowSettings(true)}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onSwitchSource={handleSourceSwitch}
        onBilibiliLogin={bilibiliAuth.handleOpenBilibiliLogin}
        onBilibiliLogout={bilibiliAuth.handleBilibiliLogout}
        dragBarHeight={windowState.dragBarHeight}
      />

      <main className="relative flex-1 min-h-0 flex flex-col overflow-y-auto animate-fade-in px-6">
        <UpdateBanner />
        <div
          className={cn(
            "min-h-0 flex-1 flex-col",
            showSettings ? "flex" : "hidden",
          )}
        >
          <SettingsPage
            open={true}
            onOpenChange={() => setShowSettings(false)}
            defaultTab="general"
          />
        </div>

        <div
          className={cn(
            "mx-auto w-full max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl flex-col gap-3 py-4",
            showHistory ? "flex" : "hidden",
          )}
        >
          <DownloadHistoryPanel
            historySearch={dm.historySearch}
            setHistorySearch={dm.setHistorySearch}
            historySourceFilter={dm.historySourceFilter}
            setHistorySourceFilter={dm.setHistorySourceFilter}
            historyStatusFilter={dm.historyStatusFilter}
            setHistoryStatusFilter={dm.setHistoryStatusFilter}
            filteredHistoryTasks={dm.filteredHistoryTasks}
            hasDownloadTasks={dm.hasDownloadTasks}

            onClearHistory={() => void dm.handleClearDownloadHistory()}
            onCancelVideoDownload={dm.handleCancelVideoDownload ?? (() => {})}
            onCancelBatchDownloads={dm.handleCancelBatchDownloads}
            onRetryBatchItem={(task, item) =>
              void dm.handleRetryBatchItem(task, item, parser.videoTitle)
            }
            onRetryAllFailedBatchItems={(task) =>
              void dm.handleRetryAllFailedBatchItems(
                task,
                parser.videoTitle,
                settingsData?.batchParseIntervalMs ?? 1500,
              )
            }
            onOpenDownloadedFile={dm.handleOpenDownloadedFile}
            onRevealDownloadedFile={dm.handleRevealDownloadedFile}
            onOpenBatchDirectory={dm.handleOpenBatchDirectory}
            onDeleteTask={(taskId) => void dm.handleDeleteDownloadTask(taskId)}
            onToggleTaskExpanded={(taskId) =>
              dm.setDownloadHistoryTasks((tasks) =>
                tasks.map((historyTask) =>
                  historyTask.id === taskId
                    ? {
                        ...historyTask,
                        expanded: !historyTask.expanded,
                        updatedAt: Date.now(),
                      }
                    : historyTask,
                ),
              )
            }
          />
        </div>

        <div
          className={cn(
            "flex-col items-center flex-1",
            !showSettings && !showHistory
              ? "flex"
              : "pointer-events-none absolute inset-x-6 top-0 flex opacity-0",
          )}
        >
          <MainContent
            activeSource={activeSource}
            downloadUrl={downloadUrl}
            onDownloadUrlChange={setDownloadUrl}
            isCurlDialogOpen={isCurlDialogOpen}
            setIsCurlDialogOpen={setIsCurlDialogOpen}
            curlImports={curlImports}
            setCurlImports={setCurlImports}
            parser={parser}
            bilibiliAuth={bilibiliAuth}
            dm={dm}
            onStartDownload={handleStartDownload}
            onStartBilibiliBatchDownload={handleStartBilibiliBatchDownload}
            onSelectM3u8Candidate={handleSelectM3u8Candidate}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
