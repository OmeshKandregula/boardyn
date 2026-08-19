"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, workspaceInvites, workspaceMembers, workspaces } from "@/db/schema";
import { colorFor } from "@/lib/constants";
import { ids, slugify } from "@/lib/ids";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  RULES,
  clientAddress,
  consume,
  describeRetry,
  loginKeys,
  maybeSweep,
  reset,
  signupKey,
} from "@/lib/rate-limit";
import { createSession, destroySession } from "@/lib/session";

export type FormState = { error?: string } | undefined;

/**
 * Sign-in checks only that something was typed. A length rule here would lock
 * out anyone whose password predates a policy change, and it tells an attacker
 * where the floor is. Length is a rule about choosing a password, not about
 * presenting one, so it lives on the signup schema alone.
 */
const signinSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

const signupSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(10, "Use at least 10 characters"),
  name: z.string().min(1, "Tell us your name").max(80),
  inviteToken: z.string().optional(),
});

export async function signUp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
    inviteToken: String(formData.get("inviteToken") ?? "") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, email, password, inviteToken } = parsed.data;

  // Counted before the scrypt hash below, which is the expensive part and
  // therefore the part worth protecting from being run in a loop.
  const signupLimit = await consume(
    signupKey(await clientAddress()),
    RULES.signupPerIp,
  );
  if (!signupLimit.allowed) {
    return {
      error: `Too many accounts created from this address. Try again in ${describeRetry(signupLimit.retryAfterSeconds)}.`,
    };
  }
  void maybeSweep();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return { error: "That email is already registered" };

  const userId = ids.user();
  await db.insert(users).values({
    id: userId,
    email,
    name,
    passwordHash: await hashPassword(password),
    avatarColor: colorFor(email),
  });

  // An invited signup joins the inviter's workspace; everyone else gets their
  // own, so a fresh instance is usable without any setup ceremony.
  let landing = "/";
  if (inviteToken) {
    const joined = await acceptInviteForUser(inviteToken, userId, email);
    if (joined) landing = `/w/${joined}`;
  }

  if (landing === "/") {
    const workspaceId = ids.workspace();
    const slug = await uniqueSlug(slugify(`${name}s-workspace`));
    await db.insert(workspaces).values({
      id: workspaceId,
      name: `${name.split(" ")[0]}'s workspace`,
      slug,
      createdBy: userId,
    });
    await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role: "owner" });
    landing = `/w/${slug}`;
  }

  await createSession(userId);
  redirect(landing);
}

export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signinSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) return { error: "Check your email and password" };

  // Both limits are counted before the password is verified. Verifying costs a
  // scrypt hash, so checking first is what keeps a flood of guesses from being
  // a CPU exhaustion attack as well as a credential one.
  const keys = loginKeys(parsed.data.email, await clientAddress());
  const [byEmail, byIp] = await Promise.all([
    consume(keys.email, RULES.loginPerEmail),
    consume(keys.ip, RULES.loginPerIp),
  ]);
  void maybeSweep();

  if (!byEmail.allowed || !byIp.allowed) {
    const wait = Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds);
    return {
      error: `Too many sign-in attempts. Try again in ${describeRetry(wait)}.`,
    };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);

  // Same message either way: a distinct "no such account" reply would turn the
  // login form into an account-enumeration oracle.
  const ok = user && (await verifyPassword(parsed.data.password, user.passwordHash));
  if (!ok) return { error: "Email or password is incorrect" };

  // Someone who mistyped a few times and then got it right should not stay
  // locked out of their own account for the rest of the window.
  await reset(keys.email);

  const inviteToken = String(formData.get("inviteToken") ?? "");
  let landing: string | null = null;
  if (inviteToken) {
    const slug = await acceptInviteForUser(inviteToken, user.id, user.email);
    if (slug) landing = `/w/${slug}`;
  }

  await createSession(user.id);
  redirect(landing ?? "/");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/**
 * Consumes an invite if it is live and addressed to this user. Returns the
 * workspace slug so the caller can land them straight on it.
 */
async function acceptInviteForUser(
  token: string,
  userId: string,
  email: string,
): Promise<string | null> {
  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.token, token))
    .limit(1);

  if (!invite) return null;
  if (invite.acceptedAt) return null;
  if (invite.expiresAt < new Date()) return null;
  if (invite.email.toLowerCase() !== email.toLowerCase()) return null;

  await db
    .insert(workspaceMembers)
    .values({ workspaceId: invite.workspaceId, userId, role: invite.role })
    .onConflictDoNothing();
  await db
    .update(workspaceInvites)
    .set({ acceptedAt: new Date() })
    .where(eq(workspaceInvites.id, invite.id));

  const [workspace] = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, invite.workspaceId))
    .limit(1);

  return workspace?.slug ?? null;
}

async function uniqueSlug(base: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
}
