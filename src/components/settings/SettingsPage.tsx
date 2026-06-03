import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Save, Globe } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { settingsApi } from "@/lib/api";
import { LanguageSettings } from "@/components/settings/LanguageSettings";
import { ThemeSettings } from "@/components/settings/ThemeSettings";
import { WindowSettings } from "@/components/settings/WindowSettings";
import { GlobalProxySettings } from "@/components/settings/GlobalProxySettings";
import { DownloadDirectorySettings } from "@/components/settings/DownloadDirectorySettings";
import { FfmpegSettings } from "@/components/settings/FfmpegSettings";
import { M3u8DownloadSettings } from "@/components/settings/M3u8DownloadSettings";
import { AboutSection } from "@/components/settings/AboutSection";
import { useSettings } from "@/hooks/useSettings";
import { useTranslation } from "react-i18next";
import type { SettingsFormState } from "@/hooks/useSettings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess?: () => void | Promise<void>;
  defaultTab?: string;
}

export function SettingsPage({
  open,
  onOpenChange,
  defaultTab = "general",
}: SettingsDialogProps) {
  const { t } = useTranslation();
  const {
    settings,
    isLoading,
    isSaving,
    isPortable,
    saveSettings,
    autoSaveSettings,
    requiresRestart,
    acknowledgeRestart,
  } = useSettings();

  const [activeTab, setActiveTab] = useState<string>("general");
  const [showRestartPrompt, setShowRestartPrompt] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
    }
  }, [open, defaultTab]);

  useEffect(() => {
    if (requiresRestart) {
      setShowRestartPrompt(true);
    }
  }, [requiresRestart]);

  const closeAfterSave = useCallback(() => {
    acknowledgeRestart();
    onOpenChange(false);
  }, [acknowledgeRestart, onOpenChange]);

  const handleSave = useCallback(async () => {
    try {
      const result = await saveSettings(undefined, { silent: false });
      if (!result) return;
      if (result.requiresRestart) {
        setShowRestartPrompt(true);
        return;
      }
      closeAfterSave();
    } catch (error) {
      console.error("[SettingsPage] Failed to save settings", error);
    }
  }, [closeAfterSave, saveSettings]);

  const handleRestartLater = useCallback(() => {
    setShowRestartPrompt(false);
    closeAfterSave();
  }, [closeAfterSave]);

  const handleRestartNow = useCallback(async () => {
    setShowRestartPrompt(false);
    if (import.meta.env.DEV) {
      toast.success(t("settings.devModeRestartHint"), { closeButton: true });
      closeAfterSave();
      return;
    }

    try {
      await settingsApi.restart();
    } catch (error) {
      console.error("[SettingsPage] Failed to restart app", error);
      toast.error(t("settings.restartFailed"));
    } finally {
      closeAfterSave();
    }
  }, [closeAfterSave, t]);

  const handleAutoSave = useCallback(
    async (updates: Partial<SettingsFormState>) => {
      if (!settings) return;
      try {
        await autoSaveSettings(updates);
      } catch (error) {
        console.error("[SettingsPage] Failed to autosave settings", error);
        toast.error(
          t("settings.saveFailedGeneric", {
            defaultValue: "保存失败，请重试",
          }),
        );
      }
    },
    [autoSaveSettings, settings, t],
  );

  const isBusy = useMemo(() => isLoading && !settings, [isLoading, settings]);

  return (
    <div className="flex flex-col h-full overflow-hidden px-6">
      {isBusy ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-col h-full"
        >
          <TabsList className="grid w-full grid-cols-3 mb-6 glass rounded-lg">
            <TabsTrigger value="general">
              {t("settings.tabGeneral")}
            </TabsTrigger>
            <TabsTrigger value="download">
              {t("settings.tabDownload", { defaultValue: "下载" })}
            </TabsTrigger>
            <TabsTrigger value="about">{t("common.about")}</TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto overflow-x-hidden pr-2">
              <TabsContent value="general" className="space-y-6 mt-0">
                {settings ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-6"
                  >
                    <LanguageSettings
                      value={settings.language}
                      onChange={(lang) => handleAutoSave({ language: lang })}
                    />
                    <ThemeSettings />
                    <WindowSettings
                      settings={settings}
                      onChange={handleAutoSave}
                    />
                    <Accordion
                      type="multiple"
                      defaultValue={[]}
                      className="w-full space-y-4"
                    >
                      <AccordionItem
                        value="globalProxy"
                        className="rounded-xl glass-card overflow-hidden"
                      >
                        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <Globe className="h-5 w-5 text-cyan-500" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold">
                                {t("settings.advanced.globalProxy.title")}
                              </h3>
                              <p className="text-sm text-muted-foreground font-normal">
                                {t("settings.advanced.globalProxy.description")}
                              </p>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
                          <GlobalProxySettings />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </motion.div>
                ) : null}
              </TabsContent>

              <TabsContent value="download" className="space-y-6 mt-0">
                {settings ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-6"
                  >
                    <DownloadDirectorySettings
                      directory={settings.downloadDirectory}
                      onChange={handleAutoSave}
                    />
                    <M3u8DownloadSettings
                      concurrency={settings.m3u8Concurrency}
                      downloadConcurrency={settings.downloadConcurrency}
                      downloadSpeedLimit={settings.downloadSpeedLimit}
                      autoOpenAfterDownload={settings.autoOpenAfterDownload}
                      autoClassifyDownloads={settings.autoClassifyDownloads}
                      onChange={handleAutoSave}
                    />
                    <FfmpegSettings />
                  </motion.div>
                ) : null}
              </TabsContent>
              <TabsContent value="about" className="mt-0">
                <AboutSection isPortable={isPortable} />
              </TabsContent>
            </div>

            {(activeTab === "general" || activeTab === "download") &&
              settings && (
                <div
                  className="flex-shrink-0 pt-4 border-t border-border-default"
                  style={{ backgroundColor: "hsl(var(--background))" }}
                >
                  <div className="px-6 flex items-center justify-end gap-3">
                    <Button onClick={handleSave} disabled={isSaving}>
                      {isSaving ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t("settings.saving")}
                        </span>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          {t("common.save")}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
          </div>
        </Tabs>
      )}

      <Dialog
        open={showRestartPrompt}
        onOpenChange={(open) => !open && handleRestartLater()}
      >
        <DialogContent
          zIndex="alert"
          className="sm:max-w-md md:max-w-lg glass border-border"
        >
          <DialogHeader>
            <DialogTitle>{t("settings.restartRequired")}</DialogTitle>
          </DialogHeader>
          <div className="px-6">
            <p className="text-sm text-muted-foreground">
              {t("settings.restartRequiredMessage")}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={handleRestartLater}
              className="hover:bg-muted/50"
            >
              {t("settings.restartLater")}
            </Button>
            <Button
              onClick={handleRestartNow}
              className="bg-primary hover:bg-primary/90"
            >
              {t("settings.restartNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
