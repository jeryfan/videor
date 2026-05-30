import { useMutation } from "@tanstack/react-query";
import { settingsApi } from "@/lib/api";
import type { Settings } from "@/types";

export function useSaveSettingsMutation() {
  return useMutation({
    mutationFn: async (settings: Settings) => {
      await settingsApi.save(settings);
    },
  });
}
