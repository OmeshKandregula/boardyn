"use server";

import { requireCardAccess } from "@/lib/access";
import { getCardDetail } from "@/lib/queries";

export type CardDetail = {
  comments: {
    id: string;
    body: string;
    createdAt: string;
    authorId: string;
    authorName: string;
    authorColor: string;
  }[];
  activity: { id: string; type: string; createdAt: string }[];
};

/**
 * Comments and history are loaded when a card is opened rather than shipped
 * with the board. A board of two hundred cards would otherwise carry every
 * comment thread on it into every page load.
 */
export async function fetchCardDetail(cardId: string): Promise<CardDetail> {
  await requireCardAccess(cardId);
  const detail = await getCardDetail(cardId);
  if (!detail) return { comments: [], activity: [] };

  return {
    comments: detail.comments,
    activity: detail.activity.map((entry) => ({
      id: entry.id,
      type: entry.type,
      createdAt: entry.createdAt,
    })),
  };
}
