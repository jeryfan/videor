import { Music2, Tv, Radio, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VideoSource } from "@/types/download";

const VIDEO_SOURCE_STORAGE_KEY = "videor-active-source";

export const VIDEO_SOURCES: Array<{
  id: VideoSource;
  label: string;
  icon: typeof Music2;
}> = [
  { id: "douyin", label: "抖音", icon: Music2 },
  { id: "bilibili", label: "Bilibili", icon: Tv },
  { id: "m3u8", label: "M3U8", icon: Radio },
  { id: "other", label: "其他", icon: Link2 },
];

export const getInitialVideoSource = (): VideoSource => {
  const saved = localStorage.getItem(
    VIDEO_SOURCE_STORAGE_KEY,
  ) as VideoSource | null;
  if (saved && VIDEO_SOURCES.some((source) => source.id === saved)) {
    return saved;
  }
  return "douyin";
};

interface SourceSwitcherProps {
  activeSource: VideoSource;
  onSwitch: (source: VideoSource) => void;
}

export function SourceSwitcher({ activeSource, onSwitch }: SourceSwitcherProps) {
  const handleSwitch = (source: VideoSource) => {
    if (source === activeSource) return;
    localStorage.setItem(VIDEO_SOURCE_STORAGE_KEY, source);
    onSwitch(source);
  };

  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-xl bg-muted p-1">
      {VIDEO_SOURCES.map(({ id, label, icon: Icon }) => {
        const isActive = id === activeSource;
        return (
          <button
            key={id}
            type="button"
            onClick={() => handleSwitch(id)}
            title={label}
            className={cn(
              "group inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-all duration-200",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="ml-2 whitespace-nowrap transition-all duration-200 max-[760px]:ml-0 max-[760px]:max-w-0 max-[760px]:overflow-hidden max-[760px]:opacity-0">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
