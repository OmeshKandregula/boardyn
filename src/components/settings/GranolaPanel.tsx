"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  connectGranola,
  disconnectGranola,
  setGranolaSyncEnabled,
  syncGranolaNow,
} from "@/app/actions/granola";

type Account = {
  keyHint: string;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  workspaceName: string;
};

export function GranolaPanel({
  account,
  workspaces,
}: {
  account: Account | null;
  workspaces: { id: string; name: string }[];
}) {
  const [, startTransition] = useTransition();
  const [key, setKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="panel p-5">
      <h2 className="mb-1 text-sm font-semibold">Granola</h2>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--color-ink-muted)]">
        Pulls your meeting notes in and reads the action items out of them, so
        what a meeting decided can become cards without retyping. Notes stay
        private to you unless two or more people from the workspace were in the
        meeting.
      </p>

      {!account ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setBusy(true);
            startTransition(async () => {
              const result = await connectGranola(workspaceId, key);
              setBusy(false);
              if (result.error) setError(result.error);
              else setKey("");
            });
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--color-ink-muted)]">
              API key
            </span>
            <input
              type="password"
              className="field font-mono text-sm"
              placeholder="grn_..."
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
            />
          </label>

          {workspaces.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[color:var(--color-ink-muted)]">
                Notes land in
              </span>
              <select
                className="field text-sm"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button className="btn-primary" type="submit" disabled={busy || !key}>
            {busy ? "Checking the key..." : "Connect Granola"}
          </button>

          {error ? <p className="text-xs text-rose-300">{error}</p> : null}

          <p className="text-[11px] leading-relaxed text-[color:var(--color-ink-faint)]">
            Keys are issued from your Granola workspace settings, on plans that
            offer API access. The key is encrypted before it is stored and is
            never shown again. It is read-only: Granola&apos;s API cannot write
            to your notes.
          </p>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-lg bg-emerald-500/10 px-2 py-1 font-mono text-emerald-300">
              key {account.keyHint}
            </span>
            <span className="text-xs text-[color:var(--color-ink-faint)]">
              into {account.workspaceName} ·{" "}
              {account.lastSyncedAt
                ? `synced ${formatDistanceToNow(new Date(account.lastSyncedAt), { addSuffix: true })}`
                : "not synced yet"}
            </span>
          </div>

          {account.lastSyncError ? (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {account.lastSyncError}
            </p>
          ) : null}

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={account.syncEnabled}
              onChange={(event) =>
                startTransition(() => setGranolaSyncEnabled(event.target.checked))
              }
            />
            <span>
              <span className="block">Keep pulling new notes</span>
              <span className="block text-[11px] text-[color:var(--color-ink-faint)]">
                Turn off to pause without removing the key.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setStatus(null);
                startTransition(async () => {
                  const result = await syncGranolaNow();
                  setBusy(false);
                  setStatus(
                    result.error
                      ? `Sync failed: ${result.error}`
                      : `Pulled ${result.imported} note${result.imported === 1 ? "" : "s"}, found ${result.actionItems} action item${result.actionItems === 1 ? "" : "s"}.`,
                  );
                });
              }}
            >
              {busy ? "Syncing..." : "Sync now"}
            </button>

            <Link className="btn-ghost text-sm" href="/meetings">
              Open meetings
            </Link>

            <button
              className="btn-ghost text-sm text-rose-300 hover:bg-rose-500/10"
              onClick={() => {
                if (
                  confirm(
                    "Remove the key and delete the meeting notes pulled with it? The originals stay in Granola.",
                  )
                ) {
                  startTransition(() => disconnectGranola());
                }
              }}
            >
              Disconnect
            </button>
          </div>

          {status ? (
            <p className="text-xs text-[color:var(--color-ink-muted)]">{status}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
