import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TranscriptUploadForm } from "./transcript-upload-form";
import { Upload } from "lucide-react";

export function TranscriptUploadView() {
  return (
    <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
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
  <Card className="w-full">
        <CardHeader>
          <CardTitle>Upload Transcript File</CardTitle>
          <CardDescription>
            Upload a transcript file and select prompts for processing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TranscriptUploadForm />
        </CardContent>
      </Card>
    </div>
  );
}
