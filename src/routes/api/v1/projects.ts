import { createFileRoute } from "@tanstack/react-router";
import {
  archiveProject,
  createProject,
  listProjects,
  updateProject,
} from "@/lib/jev/projects.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { logActivity } from "@/lib/jev/activity.server";
import { badRequest, errorResponse, notFound, readJson } from "@/lib/jev/route-error";

export const Route = createFileRoute("/api/v1/projects")({
  server: {
    handlers: {
      // List active projects, each with rolled-up stats.
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          return Response.json({ data: await listProjects(userId) });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Create a project. Body: { name: string, slug?: string }.
      POST: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const body = await readJson<{ name?: string; slug?: string }>(request);
          if (typeof body.name !== "string" || !body.name.trim()) {
            return badRequest("name is required");
          }
          const project = await createProject(
            userId,
            body.name,
            typeof body.slug === "string" ? body.slug : undefined,
          );
          await logActivity({
            userId,
            kind: "project.created",
            summary: `Created project ${project.name}`,
            meta: { projectId: project.id, slug: project.slug },
          }).catch(() => undefined);
          return Response.json({ data: project });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Update a project. Query: ?id=<id>. Body: { name?, slug? }.
      PATCH: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const id = new URL(request.url).searchParams.get("id");
          if (!id) return badRequest("id is required");
          const body = await readJson<{ name?: string; slug?: string }>(request);
          const project = await updateProject(userId, id, {
            name: typeof body.name === "string" ? body.name : undefined,
            slug: typeof body.slug === "string" ? body.slug : undefined,
          });
          if (!project) return notFound("Project not found");
          return Response.json({ data: project });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Archive a project (soft delete). Query: ?id=<id>.
      DELETE: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const id = new URL(request.url).searchParams.get("id");
          if (!id) return badRequest("id is required");
          const archived = await archiveProject(userId, id);
          if (!archived) return notFound("Project not found");
          await logActivity({
            userId,
            kind: "project.archived",
            summary: `Archived project ${id}`,
            meta: { projectId: id },
          }).catch(() => undefined);
          return Response.json({ data: { archived } });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
