import { Mic } from "lucide-react";

export function RecordAudioHeader() {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <nav
          className="flex items-center text-sm text-muted-foreground mb-1"
          aria-label="Breadcrumb"
        >
          <a href="/home" className="hover:underline">
            Home
          </a>
          <span className="mx-2">&gt;</span>
          <span className="font-semibold">Record Audio</span>
        </nav>
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Mic className="h-5 w-5" />
          Record Audio
        </h2>
      </div>
    </div>
  );
}
