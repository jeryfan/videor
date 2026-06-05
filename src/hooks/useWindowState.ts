import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWindows, isLinux } from "@/lib/platform";
import { extractErrorMessage } from "@/utils/errorUtils";
import type { Settings } from "@/types";

const DEFAULT_DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28; // px
const HEADER_HEIGHT = 64; // px

export function useWindowState(settingsData: Settings | undefined) {
  const { t } = useTranslation();
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  const useAppWindowControls =
    isLinux() && (settingsData?.useAppWindowControls ?? false);
  const dragBarHeight = useAppWindowControls ? 32 : DEFAULT_DRAG_BAR_HEIGHT;
  const contentTopOffset = dragBarHeight + HEADER_HEIGHT;

  // Sync window maximized state
  useEffect(() => {
    let active = true;
    let unlistenResize: (() => void) | undefined;

    const setupWindowStateSync = async () => {
      try {
        const currentWindow = getCurrentWindow();
        const syncWindowMaximizedState = async () => {
          const maximized = await currentWindow.isMaximized();
          if (active) {
            setIsWindowMaximized(maximized);
          }
        };

        await syncWindowMaximizedState();
        unlistenResize = await currentWindow.onResized(() => {
          void syncWindowMaximizedState();
        });
      } catch (error) {
        console.error("[App] Failed to sync window maximized state", error);
      }
    };

    void setupWindowStateSync();
    return () => {
      active = false;
      unlistenResize?.();
    };
  }, []);

  // Sync window decorations
  useEffect(() => {
    if (!settingsData) return;
    const syncWindowDecorations = async () => {
      try {
        await getCurrentWindow().setDecorations(!useAppWindowControls);
      } catch (error) {
        console.error("[App] Failed to update window decorations", error);
      }
    };
    void syncWindowDecorations();
  }, [useAppWindowControls, settingsData]);

  const notifyWindowControlError = useCallback(
    (error: unknown) => {
      toast.error(
        t("notifications.windowControlFailed", {
          defaultValue: "窗口控制失败：{{error}}",
          error: extractErrorMessage(error),
        }),
      );
    },
    [t],
  );

  const handleWindowMinimize = useCallback(async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error("[App] Failed to minimize window", error);
      notifyWindowControlError(error);
    }
  }, [notifyWindowControlError]);

  const handleWindowToggleMaximize = useCallback(async () => {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.toggleMaximize();
      setIsWindowMaximized(await currentWindow.isMaximized());
    } catch (error) {
      console.error("[App] Failed to toggle maximize", error);
      notifyWindowControlError(error);
    }
  }, [notifyWindowControlError]);

  const handleWindowClose = useCallback(async () => {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      console.error("[App] Failed to close window", error);
      notifyWindowControlError(error);
    }
  }, [notifyWindowControlError]);

  return {
    isWindowMaximized,
    useAppWindowControls,
    dragBarHeight,
    contentTopOffset,
    handleWindowMinimize,
    handleWindowToggleMaximize,
    handleWindowClose,
  };
}
