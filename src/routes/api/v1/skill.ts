import { createFileRoute } from "@tanstack/react-router";
import { SKILL_MD } from "@/lib/jev/skill-md";

export const Route = createFileRoute("/api/v1/skill")({
  server: {
    handlers: {
      GET: async () =>
        new Response(SKILL_MD, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=60",
          },
        }),
    },
  },
});
