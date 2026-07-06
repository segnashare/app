import Image from "next/image";

import { cn } from "@/lib/utils/cn";

const EXPRESS_DELIVERY_ICON_SRC = "/ressources/icons/livraison-rapide.png";

type Props = {
  className?: string;
};

export function ExpressDeliveryOptionIcon({ className }: Props) {
  return (
    <Image
      src={EXPRESS_DELIVERY_ICON_SRC}
      alt=""
      width={20}
      height={20}
      className={cn("h-5 w-5 shrink-0 object-contain object-center", className)}
      unoptimized
    />
  );
}
