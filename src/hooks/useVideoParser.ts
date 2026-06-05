import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { parseVideo, type VideoFormat } from "@/lib/api/videoParser";
import { extractErrorMessage } from "@/utils/errorUtils";
import { getMatchedCurlEntry, type CurlImportEntry } from "@/lib/curlImport";
import type { VideoSource } from "@/types/download";

export function useVideoParser() {
  const { t } = useTranslation();
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const [videoFormats, setVideoFormats] = useState<VideoFormat[]>([]);
  const [selectedFormatIdx, setSelectedFormatIdx] = useState(0);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoCover, setVideoCover] = useState("");
  const [videoPlatform, setVideoPlatform] = useState("");
  const [videoItems, setVideoItems] = useState<
    NonNullable<Awaited<ReturnType<typeof parseVideo>>["items"]>
  >([]);
  const [videoKind, setVideoKind] = useState("video");
  const [videoMessage, setVideoMessage] = useState("");
  const [videoLoginRequired, setVideoLoginRequired] = useState(false);
  const [selectedVideoItems, setSelectedVideoItems] = useState<string[]>([]);
  const [parseStatus, setParseStatus] = useState<
    "idle" | "parsing" | "success" | "error"
  >("idle");

  const closeCurrentVideo = useCallback(() => {
    const video = previewVideoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }, []);

  const resetParsedVideoState = useCallback(() => {
    closeCurrentVideo();
    setParseStatus("idle");
    setVideoFormats([]);
    setSelectedFormatIdx(0);
    setVideoTitle("");
    setVideoCover("");
    setVideoPlatform("");
    setVideoItems([]);
    setVideoKind("video");
    setVideoMessage("");
    setVideoLoginRequired(false);
    setSelectedVideoItems([]);
  }, [closeCurrentVideo]);

  const parse = useCallback(
    async (rawInput: string, activeSource: VideoSource, curlImports: CurlImportEntry[]) => {
      if (!rawInput.trim()) {
        toast.error(t("download.emptyUrl", { defaultValue: "请输入视频链接" }));
        return;
      }

      setParseStatus("parsing");
      setVideoFormats([]);
      setSelectedFormatIdx(0);
      setVideoTitle("");
      setVideoCover("");
      setVideoPlatform("");
      setVideoItems([]);
      setVideoKind("video");
      setVideoMessage("");
      setVideoLoginRequired(false);
      setSelectedVideoItems([]);

      try {
        const matchedCurl = getMatchedCurlEntry(rawInput, curlImports)?.rawCurl;
        const info = await parseVideo(rawInput, matchedCurl, activeSource);
        setVideoFormats(info.formats);
        setVideoTitle(info.title);
        setVideoCover(info.cover_url || "");
        setVideoPlatform(info.platform);
        setVideoItems(info.items || []);
        setVideoKind(info.kind || "video");
        setVideoMessage(info.message || "");
        setVideoLoginRequired(Boolean(info.login_required));
        setSelectedVideoItems((info.items || []).map((item) => item.id));
        setParseStatus("success");
      } catch (error) {
        console.error("[VideoParser] Failed to parse:", error);
        toast.error(extractErrorMessage(error) || t("video.parseFailed"));
        setParseStatus("error");
      }
    },
    [t],
  );

  const parseM3u8Candidate = useCallback(
    async (url: string, curlImports: CurlImportEntry[]) => {
      setParseStatus("parsing");
      setVideoFormats([]);
      setVideoItems([]);
      setVideoMessage("");
      try {
        const matchedCurl = getMatchedCurlEntry(url, curlImports)?.rawCurl;
        const info = await parseVideo(url, matchedCurl, "m3u8");
        setVideoFormats(info.formats);
        setVideoTitle(info.title);
        setVideoCover(info.cover_url || "");
        setVideoPlatform(info.platform);
        setVideoItems(info.items || []);
        setVideoKind(info.kind || "video");
        setVideoMessage(info.message || "");
        setVideoLoginRequired(Boolean(info.login_required));
        setSelectedVideoItems((info.items || []).map((item) => item.id));
        setParseStatus("success");
      } catch (error) {
        console.error("[VideoParser] Failed to parse M3U8 candidate:", error);
        toast.error(extractErrorMessage(error) || t("video.parseFailed"));
        setParseStatus("error");
      }
    },
    [t],
  );

  return {
    previewVideoRef,
    videoFormats,
    selectedFormatIdx,
    setSelectedFormatIdx,
    videoTitle,
    videoCover,
    videoPlatform,
    videoItems,
    videoKind,
    videoMessage,
    videoLoginRequired,
    selectedVideoItems,
    setSelectedVideoItems,
    parseStatus,
    closeCurrentVideo,
    resetParsedVideoState,
    parse,
    parseM3u8Candidate,
  };
}
