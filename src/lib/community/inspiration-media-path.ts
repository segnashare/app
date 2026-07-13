const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "qt"]);

function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase().trim() ?? "";
}

export function isVideoMediaUrl(url: string): boolean {
  const withoutQuery = url.split("?")[0] ?? url;
  return VIDEO_EXTENSIONS.has(fileExtension(withoutQuery));
}
