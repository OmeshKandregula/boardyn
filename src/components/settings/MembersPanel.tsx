"use client";

import { useState, useTransition } from "react";
import { inviteMember, removeMember, revokeInvite } from "@/app/actions/workspaces";
import { Avatar } from "@/components/Avatar";
import type { Member } from "@/lib/queries";

export function MembersPanel({
  workspaceId,
  workspaceName,
  currentUserId,
  isOwner,
  members,
  invites,
}: {
  workspaceId: string;
  workspaceName: string;
  currentUserId: string;
  isOwner: boolean;
  members: Member[];
  invites: { id: string; email: string; token: string; expiresAt: string }[];
}) {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <section className="panel p-5">
      <h2 className="mb-1 text-sm font-semibold">{workspaceName}</h2>
      <p className="mb-4 text-sm text-[color:var(--color-ink-muted)]">
        Everyone here can see and edit every board in this workspace.
      </p>

      <ul className="mb-4 space-y-2">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-2.5 text-sm">
            <Avatar name={member.name} color={member.avatarColor} size="sm" />
            <span>{member.name}</span>
            <span className="text-xs text-[color:var(--color-ink-faint)]">
              {member.email}
            </span>
            {member.role === "owner" ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">
                owner
              </span>
            ) : null}
            {isOwner && member.id !== currentUserId ? (
              <button
                className="btn-ghost ml-auto px-2 py-0.5 text-xs text-rose-300 hover:bg-rose-500/10"
                onClick={() =>
                  startTransition(() => removeMember(workspaceId, member.id))
                }
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {isOwner ? (
        <>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              setLink(null);
              startTransition(async () => {
                const result = await inviteMember(workspaceId, email);
                if (result.error) setError(result.error);
                if (result.url) {
                  setLink(result.url);
                  setEmail("");
                }
              });
            }}
          >
            <input
              type="email"
              className="field"
              placeholder="cofounder@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <button className="btn-outline shrink-0" type="submit">
              Create invite
            </button>
          </form>

          {error ? (
            <p className="mt-2 text-xs text-rose-300">{error}</p>
          ) : null}

          {link ? (
            <div className="mt-3 rounded-lg bg-white/5 p-3">
              <p className="mb-1.5 text-xs text-[color:var(--color-ink-muted)]">
                Send them this link. It works once, for that email address.
              </p>
              <code className="block break-all text-xs text-[color:var(--color-ink)]">
                {link}
              </code>
              <button
                className="btn-ghost mt-2 px-2 py-1 text-xs"
                onClick={() => navigator.clipboard.writeText(link)}
              >
                Copy
              </button>
            </div>
          ) : null}

          {invites.length > 0 ? (
            <ul className="mt-4 space-y-1.5">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center gap-2 text-xs text-[color:var(--color-ink-muted)]"
                >
                  <span>{invite.email}</span>
                  <span className="text-[color:var(--color-ink-faint)]">
                    pending
                  </span>
                  <button
                    className="btn-ghost ml-auto px-2 py-0.5 text-xs"
                    onClick={() => startTransition(() => revokeInvite(invite.id))}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
