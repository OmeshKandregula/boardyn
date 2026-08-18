"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { disconnectGoogle, updateSyncPreferences } from "@/app/actions/google";

type Account = {
  email: string;
  calendarId: string;
  syncEnabled: boolean;
  pushCards: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

export function GooglePanel({
  account,
  configured,
}: {
  account: Account | null;
  configured: boolean;
}) {
  const [, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function syncNow() {
    setSyncing(true);
    setResult(null);
    try {
      const response = await fetch("/api/google/sync", { method: "POST" });
      const body = await response.json();
      setResult(
        response.ok
          ? `Pulled ${body.imported} event${body.imported === 1 ? "" : "s"}, updated ${body.cardsUpdated} card${body.cardsUpdated === 1 ? "" : "s"}.`
          : `Sync failed: ${body.error}`,
      );
    } catch (error) {
      setResult(`Sync failed: ${String(error)}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="panel p-5">
      <h2 className="mb-1 text-sm font-semibold">Google Calendar</h2>
      <p className="mb-4 text-sm text-[color:var(--color-ink-muted)]">
        Cards you are assigned to, with a date, appear on your calendar. Moving
        the event in Google moves the card. Everyone else&apos;s events show
        behind the calendar view so you can see when there is room.
      </p>

      {!configured ? (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          This instance has no Google OAuth client configured. Add
          GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env to enable it.
        </p>
      ) : !account ? (
        <a className="btn-primary" href="/api/google/start">
          Connect Google Calendar
        </a>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-emerald-300">
              {account.email}
            </span>
            <span className="text-xs text-[color:var(--color-ink-faint)]">
              {account.lastSyncedAt
                ? `Last synced ${formatDistanceToNow(new Date(account.lastSyncedAt), { addSuffix: true })}`
                : "Not synced yet"}
            </span>
          </div>

          {account.lastSyncError ? (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {account.lastSyncError}
            </p>
          ) : null}

          <div className="space-y-2 text-sm">
            <Toggle
              label="Keep syncing"
              hint="Turn off to pause without disconnecting."
              checked={account.syncEnabled}
              onChange={(value) =>
                startTransition(() => updateSyncPreferences({ syncEnabled: value }))
              }
            />
            <Toggle
              label="Put my cards on my calendar"
              hint="Off means events flow in only, and nothing is written to Google."
              checked={account.pushCards}
              onChange={(value) =>
                startTransition(() => updateSyncPreferences({ pushCards: value }))
              }
            />
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-[color:var(--color-ink-muted)]">
              Calendar id
            </span>
            <input
              className="field"
              defaultValue={account.calendarId}
              onBlur={(event) => {
                const next = event.target.value.trim() || "primary";
                if (next !== account.calendarId) {
                  startTransition(() =>
                    updateSyncPreferences({ calendarId: next }),
                  );
                }
              }}
            />
            <span className="mt-1 block text-[11px] text-[color:var(--color-ink-faint)]">
              &quot;primary&quot; is your main calendar. Use a specific id to keep
              work blocks off it.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-outline"
              onClick={syncNow}
              disabled={syncing}
              type="button"
            >
              {syncing ? "Syncing..." : "Sync now"}
            </button>
            <a className="btn-ghost text-sm" href="/api/google/start">
              Reconnect
            </a>
            <button
              type="button"
              className="btn-ghost text-sm text-rose-300 hover:bg-rose-500/10"
              onClick={() => {
                if (
                  confirm(
                    "Disconnect Google Calendar? Events already on your calendar stay there.",
                  )
                ) {
                  startTransition(() => disconnectGoogle());
                }
              }}
            >
              Disconnect
            </button>
          </div>

          {result ? (
            <p className="text-xs text-[color:var(--color-ink-muted)]">{result}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>
        <span className="block">{label}</span>
        <span className="block text-[11px] text-[color:var(--color-ink-faint)]">
          {hint}
        </span>
      </span>
    </label>
  );
}
