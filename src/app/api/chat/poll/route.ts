import { allowRequest, clientKey } from "@/lib/rate-limit";
import { ChatError, pollChat, type ChatMode } from "@/lib/youtube";

const API_KEY = /^[A-Za-z0-9_-]{10,80}$/;
const VERSION = /^[0-9.]+$/;
const TOKEN = /^[\w.+\/=%-]+$/;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "O pedido não veio em JSON." }, { status: 400 });
  }

  if (!allowRequest(clientKey(request, "poll"), 180, 60_000)) {
    return Response.json(
      { error: "Muitas leituras seguidas. A peneira espera o intervalo do chat." },
      { status: 429 },
    );
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const apiKey = typeof record.apiKey === "string" ? record.apiKey : "";
  const clientVersion = typeof record.clientVersion === "string" ? record.clientVersion : "";
  const continuation = typeof record.continuation === "string" ? record.continuation : "";
  const mode: ChatMode = record.mode === "replay" ? "replay" : "live";

  if (
    !API_KEY.test(apiKey) ||
    !VERSION.test(clientVersion) ||
    continuation.length < 10 ||
    continuation.length > 12_000 ||
    !TOKEN.test(continuation)
  ) {
    return Response.json({ error: "Sessão do chat inválida. Abra a live de novo." }, { status: 400 });
  }

  try {
    const batch = await pollChat({ apiKey, clientVersion, continuation, mode });
    return Response.json(batch);
  } catch (error) {
    if (error instanceof ChatError) {
      return Response.json({ error: error.message, code: error.code }, { status: 502 });
    }
    return Response.json({ error: "Falha ao ler o chat." }, { status: 502 });
  }
}
