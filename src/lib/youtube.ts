export type ChatKind =
  | "text"
  | "superchat"
  | "sticker"
  | "member"
  | "gift"
  | "system";

export type ChatMode = "live" | "replay";

export type ChatMessage = {
  id: string;
  kind: ChatKind;
  author: string;
  badges: string[];
  text: string;
  timestampUsec: string;
  amountText?: string;
  amountValue?: number;
  color?: string;
};

export type OpenedChat = {
  videoId: string;
  title: string;
  channel: string;
  mode: ChatMode;
  apiKey: string;
  clientVersion: string;
  continuation: string;
  timeoutMs: number;
  messages: ChatMessage[];
};

export type PollBatch = {
  messages: ChatMessage[];
  continuation: string | null;
  timeoutMs: number;
  ended: boolean;
};

export class ChatError extends Error {
  constructor(
    message: string,
    readonly code: "bad-url" | "no-chat" | "upstream",
  ) {
    super(message);
    this.name = "ChatError";
  }
}

const KINDS: Record<string, ChatKind> = {
  liveChatTextMessageRenderer: "text",
  liveChatPaidMessageRenderer: "superchat",
  liveChatPaidStickerRenderer: "sticker",
  liveChatMembershipItemRenderer: "member",
  liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: "gift",
  liveChatSponsorshipsGiftRedemptionAnnouncementRenderer: "gift",
  liveChatViewerEngagementMessageRenderer: "system",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const YOUTUBE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  Cookie: "CONSENT=YES+1; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjUwMjA2LjA4X3AxGgJlbiACGgYIgLy_xAY",
};

export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const allowed =
    host === "youtu.be" ||
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com";
  if (!allowed) return null;

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }

  const fromQuery = url.searchParams.get("v");
  if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;

  const parts = url.pathname.split("/").filter(Boolean);
  const markers = new Set(["live", "shorts", "embed", "v", "live_chat"]);
  for (let i = 0; i < parts.length - 1; i++) {
    if (markers.has(parts[i]) && /^[\w-]{11}$/.test(parts[i + 1])) {
      return parts[i + 1];
    }
  }
  return null;
}

type Continuation = {
  token: string;
  timeoutMs: number;
  mode: ChatMode;
};

export function extractSetup(html: string): {
  apiKey: string;
  clientVersion: string;
  continuation: Continuation;
  messages: ChatMessage[];
} {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([A-Za-z0-9_-]+)"/)?.[1];
  const clientVersion =
    html.match(/"INNERTUBE_CLIENT_VERSION":"([0-9.]+)"/)?.[1] ??
    html.match(/"clientVersion":"([0-9.]+)"/)?.[1];
  const initial = extractAssignedJson(html, [
    "ytInitialData = ",
    "ytInitialData=",
    'window["ytInitialData"] = ',
    "window['ytInitialData'] = ",
  ]);
  const continuation = initial ? findContinuation(initial) : null;

  if (!apiKey || !clientVersion || !continuation) {
    throw new ChatError(
      "Esse vídeo não devolveu um chat. Ele precisa estar ao vivo, com o chat aberto.",
      "no-chat",
    );
  }

  return {
    apiKey,
    clientVersion,
    continuation,
    messages: initial ? dedupe(collectMessages(initial)) : [],
  };
}

export function parsePollBody(payload: unknown): PollBatch {
  const root = asRecord(payload);
  const liveChat = asRecord(asRecord(root?.continuationContents)?.liveChatContinuation);
  const messages = parseActions(liveChat?.actions);
  const next = liveChat ? findContinuation(liveChat) : null;
  return {
    messages,
    continuation: next?.token ?? null,
    timeoutMs: clampTimeout(next?.timeoutMs ?? 5000),
    ended: !next,
  };
}

export async function openChat(input: string): Promise<OpenedChat> {
  const videoId = parseVideoId(input);
  if (!videoId) {
    throw new ChatError(
      "Não achei um vídeo nesse texto. Cole o link da live ou o código de 11 caracteres.",
      "bad-url",
    );
  }

  const [meta, popout] = await Promise.all([
    fetchOEmbed(videoId),
    fetchText(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`),
  ]);

  let setup: ReturnType<typeof extractSetup>;
  try {
    setup = extractSetup(popout);
  } catch (error) {
    if (!(error instanceof ChatError)) throw error;
    const watch = await fetchText(`https://www.youtube.com/watch?v=${videoId}`);
    setup = extractSetup(watch);
  }

  return {
    videoId,
    title: meta.title,
    channel: meta.channel,
    mode: setup.continuation.mode,
    apiKey: setup.apiKey,
    clientVersion: setup.clientVersion,
    continuation: setup.continuation.token,
    timeoutMs: clampTimeout(setup.continuation.timeoutMs),
    messages: setup.messages,
  };
}

export async function pollChat(input: {
  apiKey: string;
  clientVersion: string;
  continuation: string;
  mode: ChatMode;
}): Promise<PollBatch> {
  const endpoint =
    input.mode === "replay" ? "get_live_chat_replay" : "get_live_chat";
  const url = `https://www.youtube.com/youtubei/v1/live_chat/${endpoint}?key=${encodeURIComponent(input.apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: {
      ...YOUTUBE_HEADERS,
      "Content-Type": "application/json",
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": input.clientVersion,
    },
    body: JSON.stringify({
      context: {
        client: {
          hl: "pt",
          gl: "BR",
          clientName: "WEB",
          clientVersion: input.clientVersion,
        },
      },
      continuation: input.continuation,
    }),
  });

  if (!response.ok) {
    throw new ChatError(
      `O YouTube recusou a leitura do chat (${response.status}).`,
      "upstream",
    );
  }

  const payload: unknown = await response.json();
  return parsePollBody(payload);
}

export function clampTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) return 5000;
  return Math.min(15_000, Math.max(1000, Math.round(timeoutMs)));
}

function collectMessages(root: unknown): ChatMessage[] {
  const found: ChatMessage[] = [];
  const stack: unknown[] = [root];
  let steps = 0;
  while (stack.length > 0 && steps < 250_000) {
    const node = stack.pop();
    steps += 1;
    if (!node || typeof node !== "object") continue;
    const record = asRecord(node);
    if (record?.addChatItemAction) {
      const item = asRecord(asRecord(record.addChatItemAction)?.item);
      const parsed = item ? parseItem(item) : null;
      if (parsed) found.push(parsed);
      continue;
    }
    const children = Array.isArray(node) ? node : Object.values(node);
    for (const child of children) {
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return found;
}

function dedupe(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function parseActions(actions: unknown): ChatMessage[] {
  if (!Array.isArray(actions)) return [];
  const messages: ChatMessage[] = [];
  for (const action of actions) {
    const item = asRecord(asRecord(action)?.addChatItemAction)?.item;
    const parsed = item ? parseItem(asRecord(item)) : null;
    if (parsed) messages.push(parsed);
  }
  return messages;
}

function parseItem(item: Record<string, unknown> | null): ChatMessage | null {
  if (!item) return null;
  for (const [key, kind] of Object.entries(KINDS)) {
    const renderer = asRecord(item[key]);
    if (renderer) return fromRenderer(renderer, kind);
  }
  return null;
}

function fromRenderer(
  renderer: Record<string, unknown>,
  kind: ChatKind,
): ChatMessage | null {
  const author =
    textOf(renderer.authorName).trim() || (kind === "system" ? "YouTube" : "Alguém");
  const sticker = asRecord(renderer.sticker);
  const accessibility = asRecord(asRecord(sticker?.accessibility)?.accessibilityData);
  const header = asRecord(renderer.header);
  const text =
    textOf(renderer.message).trim() ||
    textOf(renderer.headerSubtext).trim() ||
    textOf(header?.primaryText).trim() ||
    textOf(renderer.primaryText).trim() ||
    (typeof accessibility?.label === "string" ? accessibility.label : "");
  const amountText = textOf(renderer.purchaseAmountText).trim() || undefined;
  const timestampUsec =
    typeof renderer.timestampUsec === "string"
      ? renderer.timestampUsec
      : typeof renderer.timestampUsec === "number"
        ? String(renderer.timestampUsec)
        : "0";
  const id =
    typeof renderer.id === "string" && renderer.id
      ? renderer.id
      : `${kind}:${author}:${timestampUsec}:${text}`;
  if (!text && !amountText && kind === "system") return null;

  return {
    id,
    kind,
    author,
    badges: badgesOf(renderer.authorBadges),
    text: text || amountText || kindLabel(kind),
    timestampUsec,
    amountText,
    amountValue: parseAmount(amountText),
    color: colorOf(renderer.bodyBackgroundColor ?? renderer.headerBackgroundColor),
  };
}

function kindLabel(kind: ChatKind): string {
  switch (kind) {
    case "superchat":
      return "Super Chat";
    case "sticker":
      return "figurinha";
    case "member":
      return "novo membro";
    case "gift":
      return "assinatura de presente";
    case "system":
      return "aviso";
    default:
      return "";
  }
}

function badgesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const badges: string[] = [];
  for (const entry of value) {
    const badge = asRecord(asRecord(entry)?.liveChatAuthorBadgeRenderer);
    const tooltip = badge && typeof badge.tooltip === "string" ? badge.tooltip : "";
    const icon = asRecord(badge?.icon);
    const iconType = icon && typeof icon.iconType === "string" ? icon.iconType : "";
    const label = tooltip || iconType.replaceAll("_", " ").toLowerCase();
    if (label) badges.push(label);
  }
  return badges;
}

function textOf(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  const record = asRecord(node);
  if (!record) return "";
  if (typeof record.simpleText === "string") return record.simpleText;
  if (typeof record.label === "string" && !record.runs) return record.label;
  if (!Array.isArray(record.runs)) return "";
  return record.runs.map(runText).join("");
}

function runText(run: unknown): string {
  const record = asRecord(run);
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  const emoji = asRecord(record.emoji);
  if (!emoji) return "";
  if (Array.isArray(emoji.shortcuts) && typeof emoji.shortcuts[0] === "string") {
    return emoji.shortcuts[0];
  }
  return typeof emoji.emojiId === "string" ? emoji.emojiId : "";
}

function parseAmount(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^\d,.-]/g, "");
  if (!cleaned) return undefined;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma >= 0 && lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function colorOf(value: unknown): string | undefined {
  if (typeof value === "string" && value.startsWith("#")) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const hex = (value >>> 0).toString(16).padStart(8, "0").slice(2);
    return `#${hex}`;
  }
  return undefined;
}

function findContinuation(root: unknown): Continuation | null {
  let replay: Continuation | null = null;
  const stack: unknown[] = [root];
  let steps = 0;
  while (stack.length > 0 && steps < 250_000) {
    const node = stack.pop();
    steps += 1;
    if (!node || typeof node !== "object") continue;
    const direct = readContinuation(node);
    if (direct) {
      if (direct.mode === "live") return direct;
      replay ??= direct;
    }
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return replay;
}

function readContinuation(node: unknown): Continuation | null {
  const record = asRecord(node);
  if (!record) return null;
  const options: Array<[string, ChatMode]> = [
    ["invalidationContinuationData", "live"],
    ["timedContinuationData", "live"],
    ["reloadContinuationData", "live"],
    ["liveChatReplayContinuationData", "replay"],
  ];
  for (const [key, mode] of options) {
    const data = asRecord(record[key]);
    if (!data || typeof data.continuation !== "string" || !data.continuation) {
      continue;
    }
    const timeoutMs = typeof data.timeoutMs === "number" ? data.timeoutMs : 5000;
    return { token: data.continuation, timeoutMs, mode };
  }
  return null;
}

function extractAssignedJson(html: string, markers: string[]): unknown | null {
  for (const marker of markers) {
    const at = html.indexOf(marker);
    if (at < 0) continue;
    const start = html.indexOf("{", at + marker.length);
    if (start < 0) continue;
    const slice = sliceJsonObject(html, start);
    if (!slice) continue;
    try {
      return JSON.parse(slice) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

function sliceJsonObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

async function fetchOEmbed(videoId: string): Promise<{ title: string; channel: string }> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: YOUTUBE_HEADERS },
    );
    if (!response.ok) return { title: "Live do YouTube", channel: "" };
    const payload = asRecord(await response.json());
    return {
      title: typeof payload?.title === "string" ? payload.title : "Live do YouTube",
      channel: typeof payload?.author_name === "string" ? payload.author_name : "",
    };
  } catch {
    return { title: "Live do YouTube", channel: "" };
  }
}

async function fetchText(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: YOUTUBE_HEADERS,
    });
    if (!response.ok) {
      throw new ChatError(
        `O YouTube não abriu a página do chat (${response.status}).`,
        "upstream",
      );
    }
    return await response.text();
  } catch (error) {
    if (error instanceof ChatError) throw error;
    throw new ChatError("Não consegui falar com o YouTube agora.", "upstream");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
