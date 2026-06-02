import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getVersion } from "@tauri-apps/api/app";
import { useUpdate } from "@/contexts/UpdateContext";
import { relaunchApp } from "@/lib/updater";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import appIcon from "@/assets/icons/app-icon.png";

interface AboutSectionProps {
  isPortable: boolean;
}

export function AboutSection({ isPortable }: AboutSectionProps) {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [isLoadingVersion, setIsLoadingVersion] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  const {
    hasUpdate,
    updateInfo,
    updateHandle,
    checkUpdate,
    resetDismiss,
    isChecking,
  } = useUpdate();

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const appVersion = await getVersion();
        if (active) {
          setVersion(appVersion);
        }
      } catch (error) {
        console.error("[AboutSection] Failed to load version", error);
        if (active) {
          setVersion(null);
        }
      } finally {
        if (active) {
          setIsLoadingVersion(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const handleCheckUpdate = async () => {
    if (hasUpdate && updateHandle) {
      if (isPortable) {
        toast.info(t("settings.portableUpdateHint"));
        return;
      }

      setIsDownloading(true);
      try {
        resetDismiss();
        await updateHandle.downloadAndInstall();
        await relaunchApp();
      } catch (error) {
        console.error("[AboutSection] Update failed", error);
        toast.error(t("settings.updateFailed"));
      } finally {
        setIsDownloading(false);
      }
      return;
    }

    try {
      const available = await checkUpdate();
      if (!available) {
        toast.success(t("settings.upToDate"), { closeButton: true });
      }
    } catch (error) {
      console.error("[AboutSection] Check update failed", error);
      toast.error(t("settings.checkUpdateFailed"));
    }
  };

  const displayVersion = version ?? t("common.unknown");

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("common.about")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("settings.aboutHint")}
        </p>
      </header>

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-6 space-y-5 shadow-sm"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <img src={appIcon} alt="Videor" className="h-5 w-5" />
              <h4 className="text-lg font-semibold text-foreground">Videor</h4>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1.5 bg-background/80">
                <span className="text-muted-foreground">
                  {t("common.version")}
                </span>
                {isLoadingVersion ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="font-medium">{`v${displayVersion}`}</span>
                )}
              </Badge>
              {isPortable && (
                <Badge variant="secondary" className="gap-1.5">
                  <Info className="h-3 w-3" />
                  {t("settings.portableMode")}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleCheckUpdate}
              disabled={isChecking || isDownloading}
              className="h-8 gap-1.5 text-xs"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("settings.updating")}
                </>
              ) : hasUpdate ? (
                <>
                  <Download className="h-3.5 w-3.5" />
                  {t("settings.updateTo", {
                    version: updateInfo?.availableVersion ?? "",
                  })}
                </>
              ) : isChecking ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {t("settings.checking")}
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("settings.checkForUpdates")}
                </>
              )}
            </Button>
          </div>
        </div>

        {hasUpdate && updateInfo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="rounded-lg bg-primary/10 border border-primary/20 px-4 py-3 text-sm"
          >
            <p className="font-medium text-primary mb-1">
              {t("settings.updateAvailable", {
                version: updateInfo.availableVersion,
              })}
            </p>
            {updateInfo.notes && (
              <p className="text-muted-foreground line-clamp-3 leading-relaxed">
                {updateInfo.notes}
              </p>
            )}
          </motion.div>
        )}
      </motion.div>
    </motion.section>
  );
}
