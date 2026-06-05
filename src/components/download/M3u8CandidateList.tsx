import { useTranslation } from "react-i18next";
import type { VideoItem } from "@/lib/api/videoParser";

interface M3u8CandidateListProps {
  videoTitle: string;
  videoMessage: string;
  videoItems: VideoItem[];
  onSelectCandidate: (url: string) => void;
}

export function M3u8CandidateList({
  videoTitle,
  videoMessage,
  videoItems,
  onSelectCandidate,
}: M3u8CandidateListProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 animate-fade-in space-y-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {videoTitle || t("video.m3u8.candidatesTitle")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {videoMessage ||
            t("video.m3u8.candidatesCount", {
              count: videoItems.length,
            })}
        </p>
      </div>
      <div className="max-h-[calc(100vh-280px)] lg:max-h-[calc(100vh-240px)] overflow-y-auto rounded-xl border border-border">
        {videoItems.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => void onSelectCandidate(item.url)}
            className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
          >
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{item.title}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {item.url}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
