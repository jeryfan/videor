import { useState, useEffect } from "react";
import {
  loadCurlImports,
  saveCurlImports,
  type CurlImportEntry,
} from "@/lib/curlImport";

export function useCurlImports() {
  const [curlImports, setCurlImports] =
    useState<CurlImportEntry[]>(loadCurlImports);

  useEffect(() => {
    saveCurlImports(curlImports);
  }, [curlImports]);

  return { curlImports, setCurlImports };
}
