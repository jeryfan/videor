import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface BilibiliLoginPromptProps {
  videoKind: string;
  videoMessage: string;
  onLogin: () => void;
}

export function BilibiliLoginPrompt({
  videoKind,
  videoMessage,
  onLogin,
}: BilibiliLoginPromptProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/30 p-4 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {videoKind === "charging_collection"
              ? t("video.bilibili.chargingCollection")
              : "Bilibili"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {videoMessage || t("video.bilibili.needLoginHint")}
          </p>
        </div>
        <Button size="sm" onClick={() => void onLogin()} className="shrink-0">
          {t("video.bilibili.scanLogin")}
        </Button>
      </div>
    </div>
  );
}
