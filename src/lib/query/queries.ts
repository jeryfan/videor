import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { settingsApi } from "@/lib/api";
import type { Settings } from "@/types";

export const useSettingsQuery = (): UseQueryResult<Settings> => {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => settingsApi.get(),
  });
};
