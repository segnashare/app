type AppLoadingScreenProps = {
  label?: string;
};

export function AppLoadingScreen({ label }: AppLoadingScreenProps) {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <div
          aria-hidden
          className="h-12 w-12 animate-spin rounded-full border-4 border-[#5E3023]/20 border-t-[#5E3023]"
        />
        {label ? <p className="text-sm font-semibold text-zinc-400">{label}</p> : null}
      </div>
    </div>
  );
}
