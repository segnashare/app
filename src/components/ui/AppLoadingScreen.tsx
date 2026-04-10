type AppLoadingScreenProps = {
  label?: string;
};

export function AppLoadingScreen({ label }: AppLoadingScreenProps) {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <div className="app-loading-dots" role="status" aria-label="Chargement">
          <span className="app-loading-dot" />
          <span className="app-loading-dot" />
          <span className="app-loading-dot" />
          <span className="app-loading-dot" />
        </div>
        {label ? <p className="text-sm font-semibold text-zinc-400">{label}</p> : null}
      </div>
    </div>
  );
}
