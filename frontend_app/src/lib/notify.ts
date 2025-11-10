// Centralized notification helpers wrapping sanitized user messages
import { userMessage } from '@/lib/errors';
import { toast } from 'sonner';

export function notifyError(err: unknown, fallback?: string) {
  toast.error(userMessage(err, fallback));
}

export function notifySuccess(message: string, opts?: { description?: string }) {
  toast.success(message, { description: opts?.description });
}

export function notifyInfo(message: string, opts?: { description?: string }) {
  toast(message, { description: opts?.description });
}
