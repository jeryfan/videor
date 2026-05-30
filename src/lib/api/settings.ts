import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "@/types";

export const settingsApi = {
  async get(): Promise<Settings> {
    return await invoke("get_settings");
  },

  async save(settings: Settings): Promise<boolean> {
    return await invoke("save_settings", { settings });
  },

  async restart(): Promise<boolean> {
    return await invoke("restart_app");
  },

  async setAutoLaunch(enabled: boolean): Promise<boolean> {
    return await invoke("set_auto_launch", { enabled });
  },
};
