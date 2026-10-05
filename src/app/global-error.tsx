"use client";

// Last-resort boundary for errors in the root layout itself.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1rem", maxWidth: 520, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Something went wrong</h1>
        <p style={{ color: "#57534e" }}>RelayDesk hit an unexpected error. Please try again.</p>
        {error.digest && <p style={{ color: "#a8a29e", fontSize: 12 }}>Reference: {error.digest}</p>}
        <button onClick={reset} style={{ marginTop: 16, padding: "8px 14px", borderRadius: 8, border: 0, background: "#dd5f06", color: "#fff" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
