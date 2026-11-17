import { allowRequest, clientKey } from "@/lib/rate-limit";
import { ChatError, openChat } from "@/lib/youtube";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "O pedido não veio em JSON." }, { status: 400 });
  }

  if (!allowRequest(clientKey(request, "open"), 12, 60_000)) {
    return Response.json(
      { error: "Muitas aberturas seguidas. Espere um minuto e tente de novo." },
      { status: 429 },
    );
  }

  const input =
    body && typeof body === "object" && "input" in body
      ? String((body as { input: unknown }).input ?? "")
      : "";

  try {
    const session = await openChat(input);
    return Response.json(session);
  } catch (error) {
    if (error instanceof ChatError) {
      const status = error.code === "bad-url" ? 400 : 422;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    return Response.json({ error: "Falha ao abrir o chat." }, { status: 500 });
  }
}
