import { useTranslation } from "react-i18next";
import { Minus, Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WindowControlsProps {
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function WindowControls({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={onMinimize}
        title={t("header.windowMinimize")}
        className="h-7 w-7"
      >
        <Minus className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleMaximize}
        title={
          isMaximized
            ? t("header.windowRestore")
            : t("header.windowMaximize")
        }
        className="h-7 w-7"
      >
        {isMaximized ? (
          <Minimize2 className="w-4 h-4" />
        ) : (
          <Maximize2 className="w-4 h-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        title={t("header.windowClose")}
        className="h-7 w-7 hover:bg-red-500/15 hover:text-red-500"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
