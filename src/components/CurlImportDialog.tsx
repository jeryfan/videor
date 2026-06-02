import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  X,
  Search,
  Globe,
  Trash2,
  Terminal,
  List,
} from "lucide-react";
import {
  type CurlImportEntry,
  type InputFormat,
  extractCurlHeaders,
  extractKeyValueHeaders,
  extractDomainFromUrl,
  importCurlEntry,
  saveCurlImports,
  saveCurlFillUrlSetting,
} from "@/lib/curlImport";
import { toast } from "sonner";

interface CurlImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  curlImports: CurlImportEntry[];
  onCurlImportsChange: (imports: CurlImportEntry[]) => void;
  downloadUrl: string;
  onFillUrl?: (url: string) => void;
}

export function CurlImportDialog({
  open,
  onOpenChange,
  curlImports,
  onCurlImportsChange,
  downloadUrl,
  onFillUrl,
}: CurlImportDialogProps) {
  const [activeTab, setActiveTab] = useState<InputFormat>("curl");
  const [inputText, setInputText] = useState("");
  const [curlFillUrl, setCurlFillUrl] = useState(() => {
    try {
      return localStorage.getItem("videor-curl-fill-url") === "true";
    } catch {
      return false;
    }
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const parsedHeaders = useMemo(() => {
    if (!inputText.trim()) return [];
    if (activeTab === "curl") {
      return extractCurlHeaders(inputText);
    }
    return extractKeyValueHeaders(inputText);
  }, [inputText, activeTab]);

  const canImport = useMemo(() => {
    if (activeTab === "curl") {
      return inputText.trim().startsWith("curl ") && parsedHeaders.length > 0;
    }
    return parsedHeaders.length > 0;
  }, [activeTab, inputText, parsedHeaders.length]);

  const matchedDomain = useMemo(() => {
    if (!downloadUrl.trim() || curlImports.length === 0) return null;
    const domain = extractDomainFromUrl(downloadUrl.trim());
    if (!domain) return null;

    const exact = curlImports.find((e) => e.domain === domain);
    if (exact) return exact.domain;

    const parts = domain.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join(".");
      const found = curlImports.find((e) => e.domain === parent);
      if (found) return found.domain;
    }
    return null;
  }, [downloadUrl, curlImports]);

  const filteredImports = useMemo(() => {
    let list = curlImports;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = curlImports.filter(
        (e) =>
          e.domain.toLowerCase().includes(q) ||
          String(e.headerCount).includes(q),
      );
    }
    // 匹配的域名置顶（仅在未搜索时）
    if (!searchQuery.trim() && matchedDomain) {
      list = [...list].sort((a, b) => {
        if (a.domain === matchedDomain) return -1;
        if (b.domain === matchedDomain) return 1;
        return 0;
      });
    }
    return list;
  }, [curlImports, searchQuery, matchedDomain]);

  const handleImport = () => {
    const result = importCurlEntry(
      inputText,
      activeTab,
      downloadUrl,
      curlImports,
    );
    if (!result.success) return;

    onCurlImportsChange(result.imports);
    saveCurlImports(result.imports);
    setInputText("");

    if (curlFillUrl && result.filledUrl && onFillUrl) {
      onFillUrl(result.filledUrl);
    }

    toast.success(
      `${result.isUpdate ? "更新" : "导入"}了 ${result.domain} 的 ${result.headerCount} 个 headers`,
    );
  };

  const handleDelete = (domain: string) => {
    const next = curlImports.filter((e) => e.domain !== domain);
    onCurlImportsChange(next);
    saveCurlImports(next);
    setDeleteTarget(null);
    toast.info(`已删除 ${domain} 的 headers`);
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value as InputFormat);
    setInputText("");
  };

  const keyValueNeedsUrl = activeTab === "keyValue" && !downloadUrl.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent zIndex="top" className="max-w-[calc(100vw-2rem)] sm:max-w-xl md:max-w-2xl lg:max-w-3xl h-[min(560px,85vh)] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="relative px-6 py-5 border-b border-border bg-muted/20">
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            导入 cURL Headers
          </DialogTitle>

          <DialogClose className="absolute right-4 top-4 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
            <span className="sr-only">关闭</span>
          </DialogClose>
        </DialogHeader>

        {/* 固定区域：Tabs + 输入框 */}
        <div className="shrink-0 px-6 pt-5 pb-0 space-y-5">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="w-full grid grid-cols-2 bg-muted p-1 rounded-lg">
              <TabsTrigger
                value="curl"
                className="gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=inactive]:opacity-60 data-[state=inactive]:hover:opacity-100 data-[state=inactive]:hover:bg-muted/50"
              >
                <Terminal className="h-3.5 w-3.5" />
                cURL 命令
              </TabsTrigger>
              <TabsTrigger
                value="keyValue"
                className="gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=inactive]:opacity-60 data-[state=inactive]:hover:opacity-100 data-[state=inactive]:hover:bg-muted/50"
              >
                <List className="h-3.5 w-3.5" />
                键值对
              </TabsTrigger>
            </TabsList>

            <TabsContent value="curl" className="mt-3 relative">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                spellCheck={false}
                placeholder="curl 'https://example.com/video' -H 'Referer: https://example.com/' -H 'User-Agent: Mozilla/5.0' ..."
                className="h-[120px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 pr-8 font-mono text-xs leading-5 !outline-none !ring-0 focus:border-primary transition-colors"
              />
              {inputText && (
                <button
                  type="button"
                  onClick={() => setInputText("")}
                  className="absolute right-2 top-2 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="清空"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </TabsContent>

            <TabsContent value="keyValue" className="mt-3 relative">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                spellCheck={false}
                placeholder="Referer: https://example.com/\nUser-Agent: Mozilla/5.0\nCookie: session=abc123"
                className="h-[120px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 pr-8 font-mono text-xs leading-5 !outline-none !ring-0 focus:border-primary transition-colors"
              />
              {inputText && (
                <button
                  type="button"
                  onClick={() => setInputText("")}
                  className="absolute right-2 top-2 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="清空"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* 滚动区域：操作栏 + 已导入列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
          {/* 底部操作栏 - 共享区域，tab 切换时高度不变 */}
          <div className="flex items-center justify-end gap-3">
            <label
              className={cn(
                "flex items-center gap-2 select-none",
                activeTab === "keyValue" ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
              )}
            >
              <input
                type="checkbox"
                checked={curlFillUrl}
                disabled={activeTab === "keyValue"}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setCurlFillUrl(checked);
                  saveCurlFillUrlSetting(checked);
                }}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span className="text-xs text-muted-foreground">
                导入时自动将 URL 填充到输入框
              </span>
            </label>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={!canImport || keyValueNeedsUrl}
            >
              导入
            </Button>
          </div>

          {/* 已导入列表 */}
          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-xs font-medium text-muted-foreground">
                已导入域名
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                  {curlImports.length}
                </span>
              </p>
              <div className="flex-1" />
              <div className="relative w-40">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索域名..."
                  className="h-7 pl-7 text-xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5 h-[200px] overflow-y-auto pr-1">
              {curlImports.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                  <Globe className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">
                    暂无已导入的域名
                  </p>
                </div>
              )}
              {filteredImports.length === 0 && curlImports.length > 0 && (
                <p className="text-center text-xs text-muted-foreground py-4">
                  无匹配结果
                </p>
              )}
              {filteredImports.map((entry) => {
                const isDeleting = deleteTarget === entry.domain;
                const isMatched = entry.domain === matchedDomain;
                return (
                  <div
                    key={entry.domain}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
                      isMatched
                        ? "border-primary/30 bg-primary/5"
                        : "border-border bg-muted/30",
                    )}
                  >
                    <Globe className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      isMatched ? "text-primary" : "text-muted-foreground",
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {entry.domain}
                      </p>
                    </div>
                    {isMatched && (
                      <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground font-medium">
                        当前匹配
                      </span>
                    )}
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      {entry.headerCount} headers
                    </span>
                    {isDeleting ? (
                      <div className="shrink-0 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(entry.domain)}
                          className="h-6 px-2 rounded-md bg-destructive text-destructive-foreground text-[10px] font-medium hover:bg-destructive/90 transition-colors"
                        >
                          确认
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(null)}
                          className="h-6 px-2 rounded-md bg-muted text-muted-foreground text-[10px] font-medium hover:bg-muted/80 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(entry.domain)}
                        className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
