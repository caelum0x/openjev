import { createFileRoute } from "@tanstack/react-router";
import { MODEL_CARDS } from "@/lib/jev/models";

export const Route = createFileRoute("/api/v1/models")({
  server: {
    handlers: {
      GET: async () => Response.json({ object: "list", data: MODEL_CARDS }),
    },
  },
});
