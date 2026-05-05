"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  /** Champs plus petits (ex. modale paramètres ~400px). */
  compact?: boolean;
  className?: string;
  itemClassName?: string;
  inputClassName?: string;
  placeholderChar?: string;
};

export function OtpInput({
  value,
  onChange,
  length = 6,
  compact = false,
  className,
  itemClassName,
  inputClassName,
  placeholderChar = "",
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const chars = Array.from({ length }, (_, index) => value[index] ?? "");

  useEffect(() => {
    if (!value) {
      refs.current[0]?.focus();
    }
  }, [value]);

  const setDigit = (index: number, digit: string) => {
    const next = chars.slice();
    next[index] = digit;
    onChange(next.join(""));
  };

  return (
    <div
      className={cn(
        "flex max-w-full items-center justify-center",
        compact ? "w-full flex-nowrap gap-2" : "flex-wrap gap-2",
        className,
      )}
    >
      {chars.map((char, index) => (
        <div
          key={index}
          className={cn("relative", compact ? "min-w-[1.625rem] flex-1 basis-0" : "shrink-0", itemClassName)}
        >
          <input
            ref={(element) => {
              refs.current[index] = element;
            }}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            autoFocus={index === 0}
            maxLength={1}
            value={char}
            onFocus={() => setActiveIndex(index)}
            onChange={(event) => {
              const raw = event.target.value.replace(/\D/g, "");
              const digit = raw.slice(-1);
              setDigit(index, digit);

              if (digit && index < length - 1) {
                refs.current[index + 1]?.focus();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !chars[index] && index > 0) {
                refs.current[index - 1]?.focus();
              }
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
              if (!pasted) return;

              event.preventDefault();
              onChange(pasted);
              refs.current[Math.min(pasted.length, length) - 1]?.focus();
            }}
            className={cn(
              compact
                ? "box-border h-11 w-full min-w-0 border-0 border-b-[1.5px] border-zinc-900 bg-transparent px-0.5 text-center text-[22px] font-semibold tabular-nums leading-none text-zinc-900 caret-transparent outline-none focus:border-zinc-900"
                : "h-[74px] w-[70px] border-0 border-b-[1.5px] border-zinc-900 bg-transparent text-center text-[56px] font-medium leading-none text-zinc-900 caret-transparent outline-none focus:border-zinc-900",
              inputClassName,
            )}
          />
          {activeIndex === index && !char ? (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute left-1/2 top-1/2 w-[1.5px] -translate-x-1/2 -translate-y-1/2 bg-zinc-900/70",
                compact ? "h-[44%] max-h-[1.1rem]" : "h-[46%] max-h-[2.25rem]",
              )}
              style={{ animation: "segnaCaretBlink 1s step-end infinite" }}
            />
          ) : null}
        </div>
      ))}
      <style jsx>{`
        @keyframes segnaCaretBlink {
          0%,
          49% {
            opacity: 1;
          }
          50%,
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
