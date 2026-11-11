"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="pt-10">
      <h1 className="text-4xl font-bold">This page could not be loaded</h1>
      <p className="mt-3 max-w-[60ch] text-muted">
        Something failed while loading this page. Your saved products and alerts are not affected.
      </p>
      <button type="button" className="btn btn-primary mt-5" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
