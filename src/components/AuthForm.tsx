"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/actions/auth";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Working..." : label}
    </button>
  );
}

export function AuthForm({
  mode,
  action,
  inviteToken,
  invitedEmail,
}: {
  mode: "signin" | "signup";
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  inviteToken?: string;
  invitedEmail?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {inviteToken ? (
        <input type="hidden" name="inviteToken" value={inviteToken} />
      ) : null}

      {mode === "signup" ? (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[color:var(--color-ink-muted)]">
            Name
          </span>
          <input name="name" className="field" autoComplete="name" required />
        </label>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-[color:var(--color-ink-muted)]">
          Email
        </span>
        <input
          name="email"
          type="email"
          className="field"
          autoComplete="email"
          defaultValue={invitedEmail}
          readOnly={Boolean(invitedEmail)}
          required
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-[color:var(--color-ink-muted)]">
          Password
        </span>
        <input
          name="password"
          type="password"
          className="field"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 10 : undefined}
          required
        />
        {mode === "signup" ? (
          <span className="text-xs text-[color:var(--color-ink-faint)]">
            At least 10 characters.
          </span>
        ) : null}
      </label>

      {state?.error ? (
        <p
          role="alert"
          className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
        >
          {state.error}
        </p>
      ) : null}

      <Submit label={mode === "signup" ? "Create account" : "Sign in"} />
    </form>
  );
}
