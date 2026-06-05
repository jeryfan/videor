import { Download, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { VideoFormat } from "@/lib/api/videoParser";

interface VideoPreviewProps {
  videoRef: React.Ref<HTMLVideoElement>;
  previewUrl: string | undefined;
  videoCover: string;
  videoTitle: string;
  videoPlatformLabel: string;
  videoFormats: VideoFormat[];
  selectedFormatIdx: number;
  onFormatChange: (index: number) => void;
  downloadTaskId: string | null;
  onStartDownload: () => void;
  downloadError: string | null;
  onVideoError: () => void;
}

export function VideoPreview({
  videoRef,
  previewUrl,
  videoCover,
  videoTitle,
  videoPlatformLabel,
  videoFormats,
  selectedFormatIdx,
  onFormatChange,
  downloadTaskId,
  onStartDownload,
  downloadError,
  onVideoError,
}: VideoPreviewProps) {
  const { t } = useTranslation();

  if (!videoFormats.length) return null;

  return (
    <div className="animate-fade-in space-y-3">
      <div className="relative group flex w-full justify-center overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          key={`${selectedFormatIdx}-${previewUrl}`}
          src={previewUrl}
          controls
          poster={videoCover || undefined}
          onError={() => {
            toast.error(t("video.previewError"));
            onVideoError();
          }}
          className="h-auto max-h-[calc(100vh-220px)] lg:max-h-[calc(100vh-180px)] w-full rounded-xl object-contain"
        />
        <div className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-end gap-2">
          {downloadTaskId ? (
            <Button
              size="sm"
              disabled
              className="bg-black/70 backdrop-blur-sm text-white border-0 gap-1.5 shadow-lg disabled:opacity-100"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("download.status.downloading")}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onStartDownload}
              className="bg-black/70 backdrop-blur-sm hover:bg-black/80 text-white border-0 gap-1.5 shadow-lg"
            >
              <Download className="w-3.5 h-3.5" />
              {t("download.downloadVideo")}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          {videoTitle ? (
            <p className="min-w-0 truncate text-sm font-medium text-foreground">
              {videoTitle}
            </p>
          ) : (
            <span className="min-w-0" />
          )}
          {videoPlatformLabel && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {t("video.sourceLabel", { label: videoPlatformLabel })}
            </span>
          )}
        </div>
        {videoFormats.length > 1 && (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t("video.qualityLabel")}
              </span>
              <select
                value={selectedFormatIdx}
                onChange={(e) => onFormatChange(Number(e.target.value))}
                className="text-xs bg-background border border-border rounded-md px-2 py-1 outline-none focus:border-primary"
              >
                {videoFormats.map((fmt, idx) => (
                  <option key={idx} value={idx}>
                    {fmt.quality}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {downloadError && (
          <p className="text-xs text-destructive">{downloadError}</p>
        )}
      </div>
    </div>
  );
}
