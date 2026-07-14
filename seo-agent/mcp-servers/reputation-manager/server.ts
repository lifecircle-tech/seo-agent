import Anthropic from "@anthropic-ai/sdk";
import { createApprovalQueue } from "../cms-connector/server.js";
import { gbpFetch, listLocations } from "../gbp-manager/server.js";
import { getGbpOAuth, getGbpReviewsClient } from "../../../libs/google.js";

// ── Helpers ───────────────────────────────────────────────────────────

const STAR_TO_INT: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

function isoToMs(iso: string): number {
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

// ── Types ─────────────────────────────────────────────────────────────

export interface ReviewItem {
  review_id: string; // full GBP resource name
  location_id: string;
  reviewer_name: string;
  rating: number; // 1–5
  comment: string;
  created_at: string; // ISO
  updated_at: string; // ISO
  has_reply: boolean;
}

// ── Tool: get_new_reviews ─────────────────────────────────────────────

export async function getNewReviews(
  siteId: number,
  sinceDate: string,
): Promise<{
  site_id: number;
  since_date: string;
  total: number;
  reviews: ReviewItem[];
}> {
  const sinceMs = isoToMs(sinceDate);
  if (!sinceMs) throw new Error(`Invalid sinceDate: "${sinceDate}"`);

  console.log(
    `[reputation] getNewReviews site_id=${siteId} since=${sinceDate}`,
  );

  const { locations } = await listLocations(siteId);

  const reviews: ReviewItem[] = [];

  for (const loc of locations.slice(1, 2)) {
    let pageToken: string | undefined;
    do {
      const data2 = await getGbpReviewsClient(loc.accountName, loc.location_id);
      // console.log("REVIEWSS: ", data2);

      // const oauth2Client = getGbpOAuth();
      // const params = {
      //   pageSize: 10,
      //   orderBy: "updateTime desc", // Optional: brings freshest reviews first
      // } as { pageSize: number; orderBy: string; pageToken?: string };

      // pageToken && (params.pageToken = encodeURIComponent(pageToken));

      // const data = (await oauth2Client.request({
      //   url: `https://mybusiness.googleapis.com/v4/${loc.accountName}/locations:batchGetReviews`,
      //   method: "POST",
      //   params: params,
      // })) as {
      //   locationReviews?: Array<{
      //     name?: string;
      //     reviews?: Array<{
      //       name: string;
      //       reviewer?: { displayName?: string; isAnonymous?: boolean };
      //       starRating?: string;
      //       comment?: string;
      //       createTime?: string;
      //       updateTime?: string;
      //       reviewReply?: { comment?: string };
      //     }>;
      //   }>;
      //   nextPageToken?: string;
      // };

      // console.log("Reviews1 : ", JSON.stringify(data, null, 1));

      // for (const r of data.reviews ?? []) {
      //   // Only include reviews created after sinceDate
      //   if (isoToMs(r.createTime ?? "") < sinceMs) continue;
      //   reviews.push({
      //     review_id: r.name,
      //     location_id: loc.location_id,
      //     reviewer_name: r.reviewer?.isAnonymous
      //       ? "Anonymous"
      //       : (r.reviewer?.displayName ?? "Unknown"),
      //     rating: STAR_TO_INT[r.starRating ?? "THREE"] ?? 3,
      //     comment: r.comment ?? "",
      //     created_at: r.createTime ?? "",
      //     updated_at: r.updateTime ?? "",
      //     has_reply: !!r.reviewReply?.comment,
      //   });
      // }

      // pageToken = data.nextPageToken;
    } while (pageToken);
  }

  reviews.sort((a, b) => isoToMs(b.created_at) - isoToMs(a.created_at));
  console.log(
    `[reputation] Found ${reviews.length} new reviews since ${sinceDate}`,
  );
  return {
    site_id: siteId,
    since_date: sinceDate,
    total: reviews.length,
    reviews,
  };
}

// ── Tool: draft_review_response ───────────────────────────────────────

export async function draftReviewResponse(
  reviewId: string,
  rating: number,
  reviewText: string,
): Promise<{
  review_id: string;
  rating: number;
  draft_response: string;
}> {
  console.log(
    `[reputation] draftReviewResponse review_id=${reviewId} rating=${rating}`,
  );

  if (rating < 1 || rating > 5)
    throw new Error("rating must be between 1 and 5");

  const tone =
    rating >= 4
      ? "warm and appreciative"
      : rating === 3
        ? "helpful and constructive"
        : "empathetic and apologetic, focused on resolution";

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are a professional business reputation manager. Write a public response to this customer review.

Rating: ${rating}/5 stars
Review: "${reviewText}"

Response guidelines:
- Tone: ${tone}
- Maximum 120 words
- Address specific points the reviewer mentioned
- Ratings 1–2: acknowledge the issue, sincerely apologize, invite them to contact us offline to resolve
- Rating 3: thank them, acknowledge their concerns, invite them back
- Ratings 4–5: express genuine gratitude, reference what they enjoyed, invite them back
- Do NOT mention competitor names
- Do NOT include a greeting or sign-off — go straight to the response

Return ONLY the response text, nothing else.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const draft = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  console.log(
    `[reputation] draftReviewResponse done for review_id=${reviewId}`,
  );
  return { review_id: reviewId, rating, draft_response: draft };
}

// ── Tool: post_response ───────────────────────────────────────────────
// Only publishes after the approval record is marked 'approved'.

export async function postResponse(approvalId: string): Promise<{
  ok: boolean;
  approval_id: string;
  review_id?: string;
}> {
  console.log(`[reputation] postResponse approval_id=${approvalId}`);

  const apiUrl = process.env.BACKEND_API_URL ?? "http://localhost:3002";
  const res = await fetch(`${apiUrl}/approvals/${approvalId}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok)
    throw new Error(`Approval ${approvalId} not found (${res.status})`);

  const approval = (await res.json()) as {
    status: string;
    type: string;
    updated_content?: Record<string, unknown>;
  };

  if (approval.status !== "approved") {
    throw new Error(
      `Approval ${approvalId} is not approved (status: ${approval.status})`,
    );
  }
  if (approval.type !== "review_response") {
    throw new Error(`Approval ${approvalId} type is not review_response`);
  }

  const reviewId = approval.updated_content?.review_id as string | undefined;
  const responseText = approval.updated_content?.response_text as
    | string
    | undefined;
  if (!reviewId || !responseText) {
    throw new Error(
      `Approval ${approvalId} missing review_id or response_text`,
    );
  }

  // PUT reply on the GBP review resource
  await gbpFetch(`/${reviewId}/reply`, {
    method: "PUT",
    body: JSON.stringify({ comment: responseText }),
  });

  console.log(
    `[reputation] postResponse posted reply for review_id=${reviewId}`,
  );
  return { ok: true, approval_id: approvalId, review_id: reviewId };
}

// ── Tool: get_review_metrics ──────────────────────────────────────────

export async function getReviewMetrics(siteId: number): Promise<{
  site_id: number;
  avg_rating: number;
  total_reviews: number;
  responded_count: number;
  response_rate: number;
  rating_distribution: Record<number, number>;
}> {
  console.log(`[reputation] getReviewMetrics site_id=${siteId}`);

  const { locations } = await listLocations(siteId);

  let total = 0;
  let responded = 0;
  let ratingSum = 0;
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const loc of locations) {
    let pageToken: string | undefined;
    do {
      const qs = pageToken
        ? `?pageSize=100&pageToken=${encodeURIComponent(pageToken)}`
        : "?pageSize=100";
      const data = (await gbpFetch(`/${loc.location_id}/reviews${qs}`)) as {
        reviews?: Array<{
          starRating?: string;
          reviewReply?: { comment?: string };
        }>;
        nextPageToken?: string;
      };

      for (const r of data.reviews ?? []) {
        const rating = STAR_TO_INT[r.starRating ?? "THREE"] ?? 3;
        total++;
        ratingSum += rating;
        dist[rating] = (dist[rating] ?? 0) + 1;
        if (r.reviewReply?.comment) responded++;
      }

      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  const avgRating = total > 0 ? Math.round((ratingSum / total) * 10) / 10 : 0;
  const responseRate =
    total > 0 ? Math.round((responded / total) * 100) / 100 : 0;

  return {
    site_id: siteId,
    avg_rating: avgRating,
    total_reviews: total,
    responded_count: responded,
    response_rate: responseRate,
    rating_distribution: dist,
  };
}
