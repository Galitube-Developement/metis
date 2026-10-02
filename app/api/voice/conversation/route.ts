import { getAuthenticatedUserId } from "@/lib/auth";
import { config } from "@/lib/config";
import { getVoiceConversation, nativeVoiceProtocolAvailable, startVoiceConversation, voiceConnection, VoiceError, voiceErrorMessage } from "@/lib/voice-conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const host = req.headers.get("host");
  const allowed = [url.origin, new URL(config.publicUrl).origin, ...(host ? [url.protocol + "//" + host] : [])];
  if (origin && !allowed.includes(origin)) throw new VoiceError("Invalid request origin.", 403);
}

function errorResponse(error: unknown) {
  return json({ error: voiceErrorMessage(error) }, error instanceof VoiceError ? error.status : 502);
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new VoiceError("A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 160 * 1024) { await reader.cancel(); throw new VoiceError("Voice request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new VoiceError("Invalid voice request."); }
}

export async function GET(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return json({ error: "Unauthorized" }, 401);
  try {
    const query = new URL(req.url).searchParams;
    const sessionId = query.get("sessionId");
    if (sessionId) {
      const session = getVoiceConversation(ownerId, sessionId);
      session.touch();
      return json(session.snapshot());
    }
    const { connection } = voiceConnection(ownerId, query.get("modelId") || "");
    const available = await nativeVoiceProtocolAvailable();
    return json({ available, connectionLabel: connection.label, ...(!available ? { reason: "Update the Codex runtime to use voice conversations." } : {}) });
  } catch (error) {
    if (!new URL(req.url).searchParams.has("sessionId") && error instanceof VoiceError && error.status === 400) {
      return json({ available: false, reason: error.message });
    }
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return json({ error: "Unauthorized" }, 401);
  try {
    sameOrigin(req);
    const body = await readBody(req);
    if (typeof body.chatId !== "string" || typeof body.modelId !== "string") throw new VoiceError("Select a chat and model to start voice.");
    return json(await startVoiceConversation({ ownerId, chatId: body.chatId, modelId: body.modelId, sdp: body.sdp, signal: req.signal }), 201);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return json({ error: "Unauthorized" }, 401);
  try {
    sameOrigin(req);
    const body = await readBody(req);
    if (typeof body.sessionId !== "string") throw new VoiceError("Voice session id is required.");
    getVoiceConversation(ownerId, body.sessionId).acceptClientEvents(body.events);
    return json({ saved: true });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return json({ error: "Unauthorized" }, 401);
  try {
    sameOrigin(req);
    const sessionId = new URL(req.url).searchParams.get("sessionId");
    if (!sessionId) throw new VoiceError("Voice session id is required.");
    const session = getVoiceConversation(ownerId, sessionId);
    await session.close();
    return json({ state: "closed", transcripts: session.snapshot().transcripts });
  } catch (error) { return errorResponse(error); }
}
