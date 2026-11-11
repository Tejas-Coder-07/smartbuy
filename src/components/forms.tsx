"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  refreshProductPrices,
  requestPasswordReset,
  runCollectionNow,
  saveAlert,
  signIn,
  signUp,
  toggleWatchlist,
  updatePassword,
  type FormState,
} from "@/app/actions";

function Message({ state }: { state: FormState }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`rounded-lg px-3 py-2 text-sm ${
        state.ok ? "bg-good-soft text-good" : "bg-danger-soft text-danger"
      }`}
    >
      {state.message}
    </p>
  );
}

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, null);
  // Controlled, so the address survives a failed attempt.
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="field"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <Link href="/forgot-password" className="text-sm">
            Forgot password?
          </Link>
        </div>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="field" />
      </div>
      <Message state={state} />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUp, null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label htmlFor="full_name" className="mb-1 block text-sm font-medium">
          Name <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          autoComplete="name"
          maxLength={80}
          className="field"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="field"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="mt-1 text-sm text-muted">Price alerts are sent to this address.</p>
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="field"
        />
        <p className="mt-1 text-sm text-muted">At least 8 characters.</p>
      </div>
      <Message state={state} />
      <button type="submit" className="btn btn-primary" disabled={pending || state?.ok === true}>
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className="field" />
      </div>
      <Message state={state} />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="field"
        />
      </div>
      <Message state={state} />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}

export function WatchButton({ productId, watching }: { productId: string; watching: boolean }) {
  const [state, action, pending] = useActionState(toggleWatchlist, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="product_id" value={productId} />
      <button type="submit" className={`btn ${watching ? "btn-quiet" : "btn-primary"}`} disabled={pending} aria-pressed={watching}>
        {pending ? "Saving…" : watching ? "Remove from watchlist" : "Save to watchlist"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function RefreshPricesButton({ productId, hasComparison }: { productId: string; hasComparison: boolean }) {
  const [state, action, pending] = useActionState(refreshProductPrices, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="product_id" value={productId} />
      <button type="submit" className="btn btn-quiet" disabled={pending}>
        {pending ? "Checking stores…" : hasComparison ? "Check prices again" : "Compare all stores"}
      </button>
      <Message state={state} />
    </form>
  );
}

export type AlertListingOption = { id: string; label: string };

export function AlertForm({
  productId,
  listings,
  current,
  suggested,
}: {
  productId: string;
  listings: AlertListingOption[];
  current: { target: number; listingId: string | null; status: string } | null;
  suggested: number | null;
}) {
  const [state, action, pending] = useActionState(saveAlert, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="product_id" value={productId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="target_price" className="mb-1 block text-sm font-medium">
            Target price (₹)
          </label>
          <input
            id="target_price"
            name="target_price"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            required
            defaultValue={current?.target ?? suggested ?? undefined}
            className="field tabular"
          />
        </div>
        <div>
          <label htmlFor="listing_id" className="mb-1 block text-sm font-medium">
            Store
          </label>
          <select id="listing_id" name="listing_id" defaultValue={current?.listingId ?? ""} className="field">
            <option value="">Any store</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Message state={state} />
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : current ? "Update alert" : "Set price alert"}
        </button>
      </div>
    </form>
  );
}

export function RunCollectionButton() {
  const [state, action, pending] = useActionState(runCollectionNow, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Collecting prices…" : "Run price collection now"}
      </button>
      <Message state={state} />
    </form>
  );
}
