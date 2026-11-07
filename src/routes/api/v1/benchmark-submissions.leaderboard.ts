import { createFileRoute } from "@tanstack/react-router";
import { errorResponse } from "@/lib/jev/route-error";
import { listPublicLeaderboardSubmissions } from "@/lib/jev/benchmark-submissions.server";

/**
 * Public, unauthenticated feed of completed external benchmark submissions,
 * for the /leaderboard page's "Gold suite" tab. Only the fields needed to
 * render a leaderboard row are returned (no endpoint URLs, no user ids, no
 * raw answers payloads) — see `listPublicLeaderboardSubmissions`.
 */
export const Route = createFileRoute("/api/v1/benchmark-submissions/leaderboard")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const data = await listPublicLeaderboardSubmissions();
          return Response.json({ data });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
