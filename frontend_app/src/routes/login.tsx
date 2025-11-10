import { Mic } from "lucide-react";

import { AuthForm } from "@/components/auth-form";
import { createFileRoute } from "@tanstack/react-router";
import { AuthDebugPanel } from "@/components/debug";
import { env } from "@/env";



function LoginPage() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
  <div className="bg-card w-full max-w-md space-y-6 rounded-xl p-8 shadow-lg mb-[150px]">
        <div className="flex flex-col items-center mb-4">
          {/* Microphone Icon (same as sidebar) */}
          <Mic className="mb-2 h-10 w-10 text-black" />
          {/* Main Title (from env) */}
          <h1 className="text-2xl font-bold text-center leading-tight">
            {env.VITE_APP_TITLE}
            <br />
            {env.VITE_APP_SUBTITLE}
          </h1>
          {/* Subtitle */}
          <div className="text-center text-base mt-2 mb-2">Log in to your account</div>
        </div>
        {/* Debug Panel - Only show when VITE_DEBUG=true */}
        <AuthDebugPanel />
        <AuthForm />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/login")({
  component: LoginPage,
});
