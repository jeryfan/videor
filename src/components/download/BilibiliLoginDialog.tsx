import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface BilibiliLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  qrImage: string;
  loginMessage: string;
  onRefreshQr: () => void;
}

export function BilibiliLoginDialog({
  open,
  onOpenChange,
  qrImage,
  loginMessage,
  onRefreshQr,
}: BilibiliLoginDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent zIndex="top" className="sm:max-w-sm md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("video.bilibili.loginTitle")}</DialogTitle>
          <DialogDescription>
            {t("video.bilibili.loginDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 px-6 py-5">
          <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-border bg-white p-3">
            {qrImage ? (
              <img
                src={qrImage}
                alt={t("video.bilibili.loginTitle")}
                className="h-full w-full"
              />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="text-center text-sm text-muted-foreground">
            {loginMessage || t("video.bilibili.waitingQr")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("video.bilibili.cancel")}
          </Button>
          <Button variant="secondary" onClick={() => void onRefreshQr()}>
            {t("video.bilibili.refreshQr")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
