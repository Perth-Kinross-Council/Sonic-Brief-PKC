import React, { useMemo } from "react";

export type AudioPlayerProps = {
  src: string;
  className?: string;
};

function inferMimeType(url: string): string | undefined {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".mp3")) return "audio/mpeg";
  if (clean.endsWith(".m4a")) return "audio/mp4";
  // For .mp4 audio-only, let the browser sniff container/codec to avoid odd metadata issues
  if (clean.endsWith(".mp4")) return undefined;
  if (clean.endsWith(".aac")) return "audio/aac";
  if (clean.endsWith(".wav")) return "audio/wav";
  if (clean.endsWith(".ogg")) return "audio/ogg";
  if (clean.endsWith(".webm")) return "audio/webm";
  if (clean.endsWith(".flac")) return "audio/flac";
  return undefined;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, className }) => {
  const type = useMemo(() => inferMimeType(src), [src]);
  return (
    <div
      className={["select-none", "w-full", className].filter(Boolean).join(" ")}
      onContextMenu={(e) => e.preventDefault()}
    >
      <audio
        className="w-full"
        controls
        preload="metadata"
        controlsList="nodownload noplaybackrate"
      >
        <source src={src} {...(type ? { type } : {})} />
        Your browser does not support the audio element.
      </audio>
    </div>
  );
};

export default AudioPlayer;
