import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  generateBilibiliLoginQr,
  getBilibiliLoginStatus,
  logoutBilibili,
  pollBilibiliLoginQr,
  type BilibiliLoginStatus,
} from "@/lib/api/videoParser";
import { extractErrorMessage } from "@/utils/errorUtils";
import type { VideoSource } from "@/types/download";

export function useBilibiliAuth(activeSource: VideoSource) {
  const { t } = useTranslation();
  const [bilibiliStatus, setBilibiliStatus] =
    useState<BilibiliLoginStatus | null>(null);
  const [isBilibiliLoginOpen, setIsBilibiliLoginOpen] = useState(false);
  const [bilibiliQrKey, setBilibiliQrKey] = useState("");
  const [bilibiliQrImage, setBilibiliQrImage] = useState("");
  const [bilibiliLoginMessage, setBilibiliLoginMessage] = useState("");

  const refreshBilibiliStatus = useCallback(async () => {
    try {
      setBilibiliStatus(await getBilibiliLoginStatus());
    } catch (error) {
      console.warn("[Bilibili] Failed to refresh login status", error);
      setBilibiliStatus({
        logged_in: false,
        message: extractErrorMessage(error),
      });
    }
  }, []);

  useEffect(() => {
    if (activeSource === "bilibili") {
      void refreshBilibiliStatus();
    }
  }, [activeSource, refreshBilibiliStatus]);

  useEffect(() => {
    if (!isBilibiliLoginOpen || !bilibiliQrKey) return;

    let active = true;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const result = await pollBilibiliLoginQr(bilibiliQrKey);
          if (!active) return;
          setBilibiliLoginMessage(result.message);
          if (result.status === "confirmed") {
            window.clearInterval(interval);
            setIsBilibiliLoginOpen(false);
            await refreshBilibiliStatus();
            toast.success(t("video.bilibili.loginSuccess"));
          }
        } catch (error) {
          if (!active) return;
          setBilibiliLoginMessage(extractErrorMessage(error));
        }
      })();
    }, 2500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [bilibiliQrKey, isBilibiliLoginOpen, refreshBilibiliStatus, t]);

  const handleOpenBilibiliLogin = useCallback(async () => {
    try {
      setBilibiliLoginMessage(t("video.bilibili.generatingQr"));
      setBilibiliQrImage("");
      setBilibiliQrKey("");
      setIsBilibiliLoginOpen(true);
      const qr = await generateBilibiliLoginQr();
      setBilibiliQrKey(qr.qrcode_key);
      setBilibiliQrImage(qr.svg);
      setBilibiliLoginMessage(t("video.bilibili.scanHint"));
    } catch (error) {
      setBilibiliLoginMessage(extractErrorMessage(error));
    }
  }, [t]);

  const handleBilibiliLogout = useCallback(async () => {
    try {
      await logoutBilibili();
      await refreshBilibiliStatus();
      toast.info(t("video.bilibili.logoutSuccess"));
    } catch (error) {
      toast.error(extractErrorMessage(error));
    }
  }, [refreshBilibiliStatus, t]);

  return {
    bilibiliStatus,
    isBilibiliLoginOpen,
    setIsBilibiliLoginOpen,
    bilibiliQrKey,
    bilibiliQrImage,
    bilibiliLoginMessage,
    handleOpenBilibiliLogin,
    handleBilibiliLogout,
  };
}
