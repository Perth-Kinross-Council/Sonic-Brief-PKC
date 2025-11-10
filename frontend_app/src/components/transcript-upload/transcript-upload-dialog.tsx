import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
// React import not needed with automatic JSX runtime

interface TranscriptUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uploading: boolean;
  uploadProgress: number;
  stepLabels: string[];
  stepProgress: number[];
  errorMessage: string;
  successMessage: string;
  convertedText: string;
  onClose?: () => void;
}

export function TranscriptUploadDialog({
  open,
  onOpenChange,
  uploading,
  uploadProgress,
  stepLabels,
  stepProgress,
  errorMessage,
  successMessage,
  convertedText,
  onClose,
}: TranscriptUploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transcript Upload & Conversion</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center mb-2">
          {uploading && <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-2" />}
        </div>
        {stepLabels.map((label, idx) => (
          <div key={idx} className="mb-1">
            <div className="text-xs font-medium mb-1">{label}</div>
            <Progress value={stepProgress[idx] || 0} className="mb-2 h-2" />
          </div>
        ))}
        {(uploadProgress > 0 && uploadProgress < 100) && (
          <Progress value={uploadProgress} className="mb-2" />
        )}
        {successMessage && (
          <div className="text-green-700 font-semibold mb-2">{successMessage}</div>
        )}
        {errorMessage && (
          <div className="text-red-600 font-semibold mb-2">{errorMessage}</div>
        )}
        <div className="mt-4">
          <div className="font-semibold mb-1">Converted Transcript Text to be Uploaded:</div>
          <div className="max-h-40 overflow-y-auto rounded-lg bg-gray-100 p-3 text-sm whitespace-pre-wrap dark:bg-gray-800">
            {convertedText || <span className="italic text-gray-400">No text extracted yet.</span>}
          </div>
        </div>
        {onClose && (
          <Button className="mt-4 w-full" onClick={onClose}>
            Close
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
