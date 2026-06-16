"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ImagePlus, Loader2, Search, Upload, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { publishCommunityInspiration } from "@/lib/community/community-actions";
import { inspirationHref } from "@/lib/community/community-source";
import type { InspirationMediaType } from "@/lib/community/types";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const BUCKET = "bucket_community";
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_DUMP_PHOTOS = 10;

type SelectedItem = { item_id: string; role_label: string };

export function CreateInspirationFlow() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [mediaType, setMediaType] = useState<InspirationMediaType>("photo");
  const [mediaPaths, setMediaPaths] = useState<string[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [videoPosterPath, setVideoPosterPath] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<ShopCatalogItem[]>([]);
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc("get_shop_catalog_items", { p_limit: 120 });
      if (rpcError || cancelled) return;
      const root = data && typeof data === "object" && !Array.isArray(data) ? (data as { items?: unknown }) : {};
      const items = Array.isArray(root.items) ? (root.items as ShopCatalogItem[]) : [];
      setCatalogItems(items);

      const paths = items.map((item) => getFirstPhotoStoragePath(item.photos)).filter(Boolean) as string[];
      const signed = await createSignedUrlsForStoragePaths(supabase, paths, 60 * 60);
      if (cancelled) return;
      const next: Record<string, string> = {};
      items.forEach((item) => {
        const path = getFirstPhotoStoragePath(item.photos);
        if (path && signed.get(path)) next[item.id] = signed.get(path)!;
      });
      setCoverUrlById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalogItems.slice(0, 40);
    return catalogItems
      .filter((item) => {
        const hay = `${item.title} ${item.brand_label ?? ""} ${item.category_label ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 40);
  }, [catalogItems, search]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      setUploading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Connecte-toi pour publier une inspi.");

        const list = Array.from(files);
        if (mediaType === "photo" && list.length !== 1) throw new Error("Choisis une photo.");
        if (mediaType === "video" && list.length !== 1) throw new Error("Choisis une vidéo.");
        if (mediaType === "dump" && (list.length < 2 || list.length > MAX_DUMP_PHOTOS)) {
          throw new Error(`Le dump nécessite entre 2 et ${MAX_DUMP_PHOTOS} photos.`);
        }

        const uploadedPaths: string[] = [];
        const localUrls: string[] = [];

        for (let i = 0; i < list.length; i++) {
          const file = list[i];
          if (mediaType === "video") {
            if (!file.type.startsWith("video/")) throw new Error("Format vidéo non supporté.");
            if (file.size > MAX_VIDEO_BYTES) throw new Error("Vidéo trop lourde (max 50 Mo).");
          } else if (!file.type.startsWith("image/")) {
            throw new Error("Format image non supporté.");
          }

          const ext = file.name.split(".").pop()?.toLowerCase() || (mediaType === "video" ? "mp4" : "jpg");
          const uploadId = `${Date.now()}-${crypto.randomUUID()}`;
          const path = `users/${user.id}/inspirations/${uploadId}/${i}.${ext}`;
          const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
            upsert: false,
            contentType: file.type || undefined,
          });
          if (uploadError) throw new Error(uploadError.message);
          uploadedPaths.push(path);
          localUrls.push(URL.createObjectURL(file));
        }

        setMediaPaths(uploadedPaths);
        setPreviewUrls(localUrls);
        if (mediaType === "video" && uploadedPaths[0]) {
          setVideoPosterPath(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur upload");
      } finally {
        setUploading(false);
      }
    },
    [mediaType, supabase],
  );

  function toggleItem(itemId: string) {
    setSelectedItems((prev) => {
      if (prev.some((row) => row.item_id === itemId)) {
        return prev.filter((row) => row.item_id !== itemId);
      }
      if (prev.length >= 12) return prev;
      return [...prev, { item_id: itemId, role_label: "" }];
    });
  }

  async function handlePublish() {
    setError(null);
    if (mediaPaths.length === 0) {
      setError("Ajoute au moins un média.");
      return;
    }
    if (selectedItems.length === 0) {
      setError("Lie au moins une pièce Segna.");
      return;
    }

    setPublishing(true);
    const result = await publishCommunityInspiration(supabase, {
      title,
      caption,
      mediaType,
      mediaBucket: BUCKET,
      mediaPaths,
      videoPosterPath,
      itemIds: selectedItems.map((row) => row.item_id),
      roleLabels: selectedItems.map((row) => row.role_label),
    });
    setPublishing(false);

    if (!result) {
      setError("Publication impossible. Réessaie dans un instant.");
      return;
    }

    router.push(inspirationHref("member", result.id));
  }

  return (
    <div className="space-y-6 pb-12">
      <button
        type="button"
        onClick={() => router.push("/community")}
        className="inline-flex items-center gap-1 text-[14px] font-medium text-zinc-700"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Retour
      </button>

      <div>
        <h1 className={cn("text-2xl font-semibold text-zinc-900", segnaPlayfairDisplay.className)}>Créer une inspi</h1>
        <p className="mt-1 text-[14px] text-zinc-600">Partage un look ou une inspiration avec les pièces Segna que tu portes.</p>
      </div>

      <section className="space-y-3">
        <p className="text-[13px] font-medium text-zinc-800">Type de contenu</p>
        <div className="flex flex-wrap gap-2">
          {([
            ["photo", "Photo"],
            ["video", "Vidéo"],
            ["dump", "Dump"],
          ] as const).map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setMediaType(type);
                setMediaPaths([]);
                setPreviewUrls([]);
              }}
              className={cn(
                "rounded-full px-4 py-2 text-[13px] font-medium",
                mediaType === type ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-[13px] font-medium text-zinc-800">Média</p>
        <input
          ref={fileInputRef}
          type="file"
          accept={mediaType === "video" ? "video/mp4,video/quicktime" : "image/*"}
          multiple={mediaType === "dump"}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepthRef.current += 1;
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setDragActive(false);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragDepthRef.current = 0;
            setDragActive(false);
            if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
          }}
          className={cn(
            "relative flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-[14px] font-medium transition-colors",
            dragActive ? "border-zinc-900 bg-zinc-100 text-zinc-900" : "border-zinc-300 bg-zinc-50 text-zinc-700",
            uploading && "pointer-events-none opacity-70",
          )}
        >
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-2"
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : dragActive ? (
              <Upload className="h-5 w-5" aria-hidden />
            ) : mediaType === "video" ? (
              <Video className="h-5 w-5" aria-hidden />
            ) : (
              <ImagePlus className="h-5 w-5" aria-hidden />
            )}
            {uploading ? "Upload en cours…" : dragActive ? "Relâche pour importer" : "Glisse un fichier ou clique pour choisir"}
          </button>
        </div>
        {previewUrls.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {previewUrls.map((url, i) => (
              <div key={url} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-zinc-100">
                {mediaType === "video" ? (
                  <video src={url} className="h-full w-full object-cover" controls playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="h-full w-full object-cover" />
                )}
                {mediaType === "dump" ? (
                  <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white">
                    {i + 1}/{previewUrls.length}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <p className="text-[13px] font-medium text-zinc-800">Pièces liées ({selectedItems.length}/12)</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une pièce…"
            className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-[14px]"
          />
        </div>
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {filteredItems.map((item) => {
            const selected = selectedItems.some((row) => row.item_id === item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border p-2 text-left",
                    selected ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white",
                  )}
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                    <RemoteCoverThumb photoUrl={coverUrlById[item.id] ?? ""} frameClassName="h-full w-full" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-zinc-900">{item.title}</p>
                    <p className="truncate text-[12px] text-zinc-500">{item.brand_label ?? item.category_label ?? ""}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre (optionnel)"
          className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-[14px]"
        />
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption / description"
          rows={3}
          className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-[14px]"
        />
      </section>

      {error ? <p className="text-[14px] text-rose-600">{error}</p> : null}

      <button
        type="button"
        disabled={publishing || uploading}
        onClick={() => void handlePublish()}
        className="w-full rounded-full bg-zinc-900 py-3 text-[15px] font-medium text-white disabled:opacity-60"
      >
        {publishing ? "Publication…" : "Publier l’inspi"}
      </button>
    </div>
  );
}
