// The AWS/Node build replaces this module with team-node.ts.
export function teamIsEnabled(): boolean { return false; }
export async function handleTeamRequest(request: Request): Promise<Response> {
  return Response.json(new URL(request.url).pathname.endsWith("/session") ? { enabled: false } : { error: "Team accounts require the Node runtime." }, { status: new URL(request.url).pathname.endsWith("/session") ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
