import { EntraAuth } from "./auth/entra-auth";
import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notifySuccess, notifyError } from '@/lib/notify';

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (response.ok) {
        const data = await response.json();
        localStorage.setItem("token", data.token);
        notifySuccess('Login Successful', { description: 'You have been successfully logged in.' });
        router.navigate({ to: "/" });
      } else {
        throw new Error("Login failed");
      }
    } catch (error) {
      notifyError(error, 'Please check your credentials and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Login</CardTitle>
        <CardDescription>
          Choose a login method to access the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={isLoading} className="mt-2 w-full">
              {isLoading ? "Logging in..." : "Login with Username/Password"}
            </Button>
          </div>
        </form>
        <div className="my-4 text-center text-xs text-muted-foreground">or</div>
        <EntraAuth />
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={() => router.navigate({ to: "/" })}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}
