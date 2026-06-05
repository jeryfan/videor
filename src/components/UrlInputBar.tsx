import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { CurlImportEntry } from "@/lib/curlImport";

interface UrlInputBarProps {
  downloadUrl: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  isCurlDialogOpen: boolean;
  onToggleCurlDialog: () => void;
  matchedCurlEntry?: CurlImportEntry | null;
}

export const UrlInputBar = forwardRef<HTMLDivElement, UrlInputBarProps>(
  function UrlInputBar(
    {
      downloadUrl,
      onChange,
      onKeyDown,
      placeholder,
      isCurlDialogOpen,
      onToggleCurlDialog,
      matchedCurlEntry,
    },
    ref,
  ) {
    const { t } = useTranslation();

    return (
      <div
        ref={ref}
        className="sticky top-0 z-30 bg-background/95 py-2 backdrop-blur-md"
      >
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/50" />
          <Input
            value={downloadUrl}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="w-full h-14 pl-11 pr-12 text-base rounded-2xl border border-border bg-background/60 shadow-none focus:ring-0 focus:border-border focus:shadow-none"
          />
          <button
            type="button"
            onClick={onToggleCurlDialog}
            title={
              matchedCurlEntry
                ? t("curlImport.usingHeaders", {
                    domain: matchedCurlEntry.domain,
                    count: matchedCurlEntry.headerCount,
                  })
                : t("curlImport.title")
            }
            className={cn(
              "absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 flex items-center justify-center rounded-lg transition-colors",
              isCurlDialogOpen
                ? "bg-muted text-foreground"
                : matchedCurlEntry
                  ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                isCurlDialogOpen && "rotate-180",
              )}
            />
            {matchedCurlEntry && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center">
                {matchedCurlEntry.headerCount}
              </span>
            )}
          </button>
        </div>
      </div>
    );
  },
);
