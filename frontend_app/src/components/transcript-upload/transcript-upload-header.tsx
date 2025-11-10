import { Upload } from "lucide-react";

export function TranscriptUploadHeader() {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <nav className="flex items-center text-sm text-muted-foreground mb-1" aria-label="Breadcrumb">
          <a href="/home" className="hover:underline">Home</a>
          <span className="mx-2">&gt;</span>
          <span className="font-semibold">Transcript Upload</span>
        </nav>
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Upload className="h-5 w-5" />
          Transcript Upload
        </h2>
        <p className="text-muted-foreground text-sm">
          Upload and manage transcript files for your AI system. Acceptable formats: .txt, .docx, .pdf
        </p>
      </div>
    </div>
  );
}
