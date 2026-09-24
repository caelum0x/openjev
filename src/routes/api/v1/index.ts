import { createFileRoute } from "@tanstack/react-router";
import { MODEL_CARDS } from "@/lib/jev/models";
import { nativeHealth } from "@/lib/jev/native.server";

export const Route = createFileRoute("/api/v1/")({
  server: {
    handlers: {
      GET: async () => {
        const engine = await nativeHealth();
        return Response.json({
          name: "openjev",
          version: "0.2",
          compatible: "https://api.typesafe.ai/v1/systemone",
          engine: engine.ok
            ? { backend: "native", version: engine.engine ?? "openjev" }
            : { backend: "typescript-fallback" },
          models: MODEL_CARDS.map((m) => ({ id: m.id, label: m.label })),
          endpoints: [
            "POST /api/v1/systemone",
            "GET  /api/v1/models",
            "GET  /api/v1/usage",
            "GET  /api/v1/keys",
            "POST /api/v1/keys",
            "POST /api/v1/cookbooks/parallel",
            "POST /api/v1/cookbooks/cascade",
            "POST /api/v1/cookbooks/consistency",
            "POST /api/v1/cookbooks/function-calling",
            "POST /api/v1/cookbooks/smarthome",
            "POST /api/v1/compact",
            "POST /api/v1/loop",
            "GET  /api/v1/skill",
          ],
        });
      },
    },
  },
});
