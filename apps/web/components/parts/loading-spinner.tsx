import { Loader2 } from "lucide-react";

export function LoadingSpinner({ className = "h-5 w-5" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}
