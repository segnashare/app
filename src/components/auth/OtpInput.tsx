"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  className?: string;
  itemClassName?: string;
  inputClassName?: string;
  placeholderChar?: string;
};

export function OtpInput({
  value,
  onChange,
  length = 6,
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
    <div className={cn("flex items-center gap-4", className)}>
      {chars.map((char, index) => (
        <div key={index} className={cn("relative", itemClassName)}>
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
              "h-[74px] w-[70px] border-0 border-b-2 border-zinc-900 bg-transparent text-center text-[56px] font-medium leading-none text-zinc-900 caret-transparent outline-none focus:border-zinc-900",
              inputClassName,
            )}
          />
          {activeIndex === index && !char ? (
            <span
              aria-hidden
              className="absolute left-1/2 top-1/2 h-[52px] w-[2px] -translate-x-1/2 -translate-y-[58%] bg-zinc-900/70"
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
