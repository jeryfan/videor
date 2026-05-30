import { useState, useCallback } from "react";

export function useSettingsMetadata() {
  const [isPortable] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false);
  const [isLoading] = useState(false);

  const acknowledgeRestart = useCallback(() => {
    setRequiresRestart(false);
  }, []);

  return {
    isPortable,
    requiresRestart,
    isLoading,
    acknowledgeRestart,
    setRequiresRestart,
  };
}
