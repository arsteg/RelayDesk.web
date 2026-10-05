"use client";

import { Alert, Button } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-12">
      <Alert tone="red" title="Something went wrong">
        {error.message && !error.digest ? error.message : "We couldn't load this page. Please try again."}
        {error.digest && <p className="mt-1 text-xs opacity-70">Reference: {error.digest}</p>}
      </Alert>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
