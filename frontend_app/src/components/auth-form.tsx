
// --- BEGIN: SonicBrief-EID AuthForm exact copy ---
import { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import "@radix-ui/themes/styles.css";
import type { LoginValues, RegisterValues } from "@/schema/auth.schema";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setStorageItem } from "@/lib/storage";
import { loginSchema, registerSchema } from "@/schema/auth.schema";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { userMessage } from '@/lib/errors';
import { EntraAuth } from "@/components/auth/entra-auth";
import { useLoginUser, useRegisterUser } from "@/lib/api";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";
import { authConfig } from "@/env";


export function AuthForm() {
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const router = useRouter();
  const { isAuthenticated: authenticated, pending } = useEnhancedUnifiedAuth();
  const [pathname, setPathname] = useState<string>(
    typeof window !== "undefined" ? window.location.pathname : "",
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPathname(window.location.pathname);
    }
    // Listen for route changes
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // All hooks must be called before any return
  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const loginUser = useLoginUser();
  const registerUser = useRegisterUser();

  const { mutateAsync: loginMutation, isPending: isLoginPending } = useMutation(
    {
      mutationKey: ["user/login"],
      mutationFn: async (values: LoginValues) =>
        await loginUser(values.email, values.password),
      onSuccess: (data) => {
        toast.success(data.message);
        setStorageItem("token", data.access_token);
  // Removed commented debug logging for legacy login success & token storage
        window.dispatchEvent(new Event("auth-changed")); // Notify app of auth state change
  router.navigate({ to: "/home" as any });
      },
      onError: (error) => {
        toast.error(userMessage(error, 'Login failed'));
      },
    },
  );

  async function onLoginSubmit(values: LoginValues) {
    await loginMutation(values);
  }

  const { mutateAsync: registerMutation, isPending: isRegisterPending } =
    useMutation({
      mutationKey: ["user/register"],
      mutationFn: async (values: RegisterValues) =>
        await registerUser(values.email, values.password),
      onSuccess: (data) => {
        toast.success(data.message);
        setActiveTab("login");
      },
      onError: (error) => {
        toast.error(userMessage(error, 'Registration failed'));
      },
    });

  async function onRegisterSubmit(values: RegisterValues) {
    await registerMutation(values);
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Removed commented debug logging: AuthForm render state
    }
    if (!pending && authenticated && pathname !== "/home") {
      // Removed commented debug logging: redirecting to /home
      if (window.location.pathname !== "/home") {
        router.navigate({ to: "/home" as any });
      }
    }
  }, [authenticated, pending, router, pathname]);

  // Debug: show unified and legacy states
  if (typeof window !== "undefined") {
    // Removed commented debug logging: AuthForm auth & token state snapshot
  }

  // Never show login form if authenticated (regardless of MSAL)
  if (!pending && authenticated) {
    return null; // Or a spinner, or just redirect
  }

  // Enhanced Debug: Log auth configuration with Azure-specific info (only when debug enabled)
  // debugConfig.showAuthDebug() block removed: not present in your env.ts

  return (
    <div className="space-y-6">
      {/* Show legacy login/register forms only if legacy auth is enabled */}
      {authConfig.isLegacyEnabled() && (
        <Tabs
          className="w-full"
          onValueChange={(value) => setActiveTab(value as "login" | "register")}
          value={activeTab}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
          <Form {...loginForm}>
            <form
              onSubmit={loginForm.handleSubmit(onLoginSubmit)}
              className="space-y-4"
            >
              <FormField
                control={loginForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter your email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={loginForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter your password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={isLoginPending || isRegisterPending}
              >
                {isLoginPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  "Login"
                )}
              </Button>
            </form>
          </Form>
        </TabsContent>
        <TabsContent value="register">
          <Form {...registerForm}>
            <form
              onSubmit={registerForm.handleSubmit(onRegisterSubmit)}
              className="space-y-4"
            >
              <FormField
                control={registerForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter your email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={registerForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Create a password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={registerForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Confirm your password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={isRegisterPending}
              >
                {isRegisterPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Registering...
                  </>
                ) : (
                  "Register"
                )}
              </Button>
            </form>
          </Form>
        </TabsContent>
      </Tabs>
      )}
      {/* Show separator and Entra Auth only when both methods are available */}
      {authConfig.isLegacyEnabled() && authConfig.isEntraEnabled() && (
        <div className="my-4 text-center text-xs text-muted-foreground">or</div>
      )}
      {/* Show Entra Auth if enabled */}
      {authConfig.isEntraEnabled() && <EntraAuth />}
    </div>
  );
}

