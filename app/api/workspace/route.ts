import { accessPolicy, workspaceStorage } from "@/lib/server/workspace-storage";
import { teamIsEnabled } from "@/lib/server/team-runtime";
import { requestDenied } from "@/lib/server/request-guard";
import { createSeed } from "@/lib/folio/seed";
import { validateWorkspace } from "@/lib/folio/model";

export const dynamic = "force-dynamic";
const bodyLimit = 10 * 1024 * 1024;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function discardBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return;
  // Cancelling an unread body can stall the next request in the local Worker
  // proxy. Drain ordinary uploads without retaining them; bound larger or slow
  // rejected streams so access checks never wait indefinitely for a sender.
  const cancel = () => void reader.cancel().catch(() => {});
  const timeout = setTimeout(cancel, 1000);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > bodyLimit) {
        cancel();
        break;
      }
    }
  } catch {
    // A disconnected sender does not change the rejection response.
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
function guard(request: Request): Response | null {
  try {
    if (teamIsEnabled()) return json({ error: "Use the authenticated team workspace." }, 403);
    const reason = requestDenied(request, accessPolicy());
    return reason ? json({ error: reason }, 403) : null;
  } catch {
    return json({ error: "Workspace access is not configured." }, 503);
  }
}
export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const row = await workspaceStorage().load(JSON.stringify(createSeed()));
    return json({
      revision: row.revision,
      workspace: validateWorkspace(JSON.parse(row.data)),
    });
  } catch (error) {
    console.error("Workspace load failed", error);
    return json(
      {
        error:
          "Could not open the workspace. Check the database setup, then retry.",
      },
      503,
    );
  }
}
export async function PUT(request: Request) {
  const denied = guard(request);
  if (denied) {
    await discardBody(request);
    return denied;
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    await discardBody(request);
    return json({ error: "Expected JSON." }, 415);
  }
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Missing workspace." }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > bodyLimit) {
        await reader.cancel();
        return json({ error: "Workspace exceeds the 10 MB limit." }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!Number.isSafeInteger(body.revision) || body.revision < 0)
      return json({ error: "Invalid revision." }, 400);
    const workspace = validateWorkspace(body.workspace);
    const saved = await workspaceStorage().save(JSON.stringify(workspace), body.revision);
    if (!saved)
      return json(
        {
          error:
            "This workspace changed in another tab. Export your unsaved backup before reloading.",
        },
        409,
      );
    return json({ revision: body.revision + 1 });
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error &&
        (/Invalid|Duplicate|page|block|list|nest|workspace|Links|heading|text|code|property/i.test(
          error.message,
        ) ||
          error.name === "ZodError"))
    )
      return json({ error: "The workspace contains invalid data." }, 400);
    console.error("Workspace save failed", error);
    return json(
      {
        error:
          "Saving failed. Your edits are still on this screen; retry or export a backup.",
      },
      503,
    );
  }
}
