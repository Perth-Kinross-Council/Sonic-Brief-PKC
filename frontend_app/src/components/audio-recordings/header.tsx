import { FileAudio, FileUp, Mic, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function AudioRecordingsHeader() {
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
          <span className="font-semibold">Audio Recordings</span>
        </nav>
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileAudio className="h-5 w-5" />
          Audio Recordings
        </h2>
        <p className="text-muted-foreground text-sm">
          Access and manage your recorded audio files with integrated transcription and analysis capabilities.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to="/audio-upload">
                <Button variant="outline" size="icon">
                  <FileUp className="h-4 w-4" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <p>Upload Audio File</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to="/record-audio">
                <Button variant="outline" size="icon">
                  <Mic className="h-4 w-4" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <p>Record Audio</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to="/transcript-upload">
                <Button variant="outline" size="icon">
                  <Upload className="h-4 w-4" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <p>Transcript Upload</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
