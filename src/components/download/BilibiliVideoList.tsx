import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { BilibiliLoginStatus } from "@/lib/api/videoParser";
import type { VideoItem } from "@/lib/api/videoParser";

interface BilibiliVideoListProps {
  videoTitle: string;
  videoKind: string;
  videoItems: VideoItem[];
  selectedVideoItems: string[];
  bilibiliStatus: BilibiliLoginStatus | null;
  activeBatchCount: number;
  onToggleSelectAll: () => void;
  onSelectItem: (itemId: string, checked: boolean) => void;
  onStartBatch: () => void;
}

export function BilibiliVideoList({
  videoTitle,
  videoKind,
  videoItems,
  selectedVideoItems,
  bilibiliStatus,
  activeBatchCount,
  onToggleSelectAll,
  onSelectItem,
  onStartBatch,
}: BilibiliVideoListProps) {
  const { t } = useTranslation();

  if (!videoItems.length) return null;

  const allSelected = selectedVideoItems.length === videoItems.length;

  return (
    <div className="mt-3 animate-fade-in space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {videoTitle}
          </p>
          <p className="text-xs text-muted-foreground">
            {videoKind === "multipart"
              ? t("video.bilibili.multipart", {
                  count: videoItems.length,
                })
              : t("video.bilibili.collection", {
                  count: videoItems.length,
                })}
            {bilibiliStatus?.logged_in
              ? ` · ${t("video.bilibili.loggedIn")} ${bilibiliStatus.username || ""}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onToggleSelectAll}>
            {allSelected
              ? t("download.action.deselectAll")
              : t("download.action.selectAll")}
          </Button>
          <Button
            size="sm"
            onClick={onStartBatch}
            disabled={selectedVideoItems.length === 0 || activeBatchCount > 0}
          >
            {activeBatchCount > 0
              ? t("video.bilibili.batchDownloading")
              : t("download.action.startBatch")}
          </Button>
        </div>
      </div>
      <div className="max-h-[calc(100vh-280px)] lg:max-h-[calc(100vh-240px)] overflow-y-auto rounded-xl border border-border">
        {videoItems.map((item, index) => {
          const checked = selectedVideoItems.includes(item.id);
          return (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/40"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  onSelectItem(item.id, event.target.checked)
                }
                className="h-4 w-4"
              />
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {item.title}
              </span>
              {item.duration ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {Math.floor(item.duration / 60)}:
                  {String(item.duration % 60).padStart(2, "0")}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
