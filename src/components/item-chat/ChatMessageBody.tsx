"use client";

import { splitChatMessageMedia } from "@/lib/item-chat/split-chat-message-media";
import { cn } from "@/lib/utils/cn";

type Props = {
  body: string;
  className?: string;
  imageClassName?: string;
};

/** Texte + miniatures si le message contient des URLs d’image (ex. photos litige). */
export function ChatMessageBody({ body, className, imageClassName }: Props) {
  const { text, imageUrls } = splitChatMessageMedia(body);
  return (
    <div className={cn("min-w-0", className)}>
      {text ? <div className="whitespace-pre-wrap break-words">{text}</div> : null}
      {imageUrls.length ? (
        <div className={cn("flex flex-wrap gap-1.5", text ? "mt-2" : null)}>
          {imageUrls.map((uri) => (
            <a
              key={uri}
              href={uri}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-[10px] bg-zinc-200/80"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- URLs signées dynamiques */}
              <img
                src={uri}
                alt="Photo du litige"
                className={cn("h-24 w-24 object-cover", imageClassName)}
              />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
