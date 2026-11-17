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

const INITIAL_DATA_MARKERS = [
  "ytInitialData = ",
  "ytInitialData=",
  'window["ytInitialData"] = ',
  "window['ytInitialData'] = ",
];

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
  const initial = extractAssignedJson(html, INITIAL_DATA_MARKERS);
  const continuation = initial ? findContinuation(initial, false) : null;

  if (!apiKey || !clientVersion || !continuation) {
    throw new ChatError(
      "Esse vídeo não devolveu um chat. Use uma live no ar ou uma live encerrada com replay de chat ligado.",
      "no-chat",
    );
  }

  if (continuation.mode === "replay") continuation.timeoutMs = 500;

  return {
    apiKey,
    clientVersion,
    continuation,
    messages: initial ? dedupe(collectMessages(initial)) : [],
  };
}

export function readConversationBar(payload: unknown): {
  token: string | null;
  replay: boolean;
  message: string | null;
} {
  const bar = asRecord(
    asRecord(asRecord(asRecord(payload)?.contents)?.twoColumnWatchNextResults)
      ?.conversationBar,
  );
  if (!bar) return { token: null, replay: false, message: null };

  const renderer = asRecord(bar.liveChatRenderer);
  if (renderer) {
    const titles = submenuTitles(renderer);
    const continuation = findContinuation(renderer, true);
    return {
      token: continuation?.token ?? null,
      replay: titles.some(isReplayTitle),
      message: null,
    };
  }

  const text = textOf(
    asRecord(asRecord(asRecord(bar.conversationBarRenderer)?.availabilityMessage)?.messageRenderer)
      ?.text,
  ).trim();
  return { token: null, replay: false, message: text || null };
}

function submenuTitles(renderer: Record<string, unknown>): string[] {
  const items = asRecord(
    asRecord(asRecord(asRecord(renderer.header)?.liveChatHeaderRenderer)?.viewSelector)
      ?.sortFilterSubMenuRenderer,
  )?.subMenuItems;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const record = asRecord(item);
      return record ? textOf(record.title) || (typeof record.title === "string" ? record.title : "") : "";
    })
    .filter(Boolean);
}

function liveReplayToken(html: string): string | null {
  const initial = extractAssignedJson(html, INITIAL_DATA_MARKERS);
  if (!initial) return null;
  const found: Array<{ title: string; token: string }> = [];
  const stack: unknown[] = [initial];
  let steps = 0;
  while (stack.length > 0 && steps < 80_000) {
    const node = stack.pop();
    steps += 1;
    const record = asRecord(node);
    if (!record) {
      if (Array.isArray(node)) for (const child of node) stack.push(child);
      continue;
    }
    if (Array.isArray(record.subMenuItems)) {
      for (const item of record.subMenuItems) {
        const entry = asRecord(item);
        if (!entry) continue;
        const title = textOf(entry.title) || (typeof entry.title === "string" ? entry.title : "");
        const token = asRecord(asRecord(entry.continuation)?.reloadContinuationData)?.continuation;
        if (title && typeof token === "string" && token.length > 40) {
          found.push({ title, token });
        }
      }
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  const live = found.find((item) => /live chat replay|replay do chat ao vivo/i.test(item.title));
  return live?.token ?? found[0]?.token ?? null;
}

function isReplayTitle(title: string): boolean {
  return /replay/i.test(title);
}

function translateChatMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("turned off") || lower.includes("desativad") || lower.includes("desligad")) {
    return "O replay do chat foi desligado neste vídeo.";
  }
  if (lower.includes("disabled") || lower.includes("is off") || lower.includes("não está disponível")) {
    return "O chat está desligado neste vídeo.";
  }
  return message;
}

export function parsePollBody(payload: unknown): PollBatch {
  const root = asRecord(payload);
  const liveChat = asRecord(asRecord(root?.continuationContents)?.liveChatContinuation);
  const messages = parseActions(liveChat?.actions);
  const next = liveChat ? findContinuation(liveChat, false) : null;
  const timeoutMs =
    next?.mode === "replay" ? 500 : clampTimeout(next?.timeoutMs ?? 5000);
  return {
    messages,
    continuation: next?.token ?? null,
    timeoutMs,
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

  try {
    const live = extractSetup(popout);
    if (live.continuation.mode === "live") return opened(videoId, meta, live);
  } catch (error) {
    if (!(error instanceof ChatError)) throw error;
  }

  const watch = await fetchText(`https://www.youtube.com/watch?v=${videoId}`);
  try {
    return opened(videoId, meta, extractSetup(watch));
  } catch (error) {
    if (!(error instanceof ChatError)) throw error;
  }

  const apiKey =
    popout.match(/"INNERTUBE_API_KEY":"([A-Za-z0-9_-]+)"/)?.[1] ??
    watch.match(/"INNERTUBE_API_KEY":"([A-Za-z0-9_-]+)"/)?.[1];
  const clientVersion =
    popout.match(/"INNERTUBE_CLIENT_VERSION":"([0-9.]+)"/)?.[1] ??
    watch.match(/"INNERTUBE_CLIENT_VERSION":"([0-9.]+)"/)?.[1] ??
    popout.match(/"clientVersion":"([0-9.]+)"/)?.[1] ??
    watch.match(/"clientVersion":"([0-9.]+)"/)?.[1];
  if (!apiKey || !clientVersion) {
    throw new ChatError(
      "Esse vídeo não devolveu um chat. Use uma live no ar ou uma live encerrada com replay de chat ligado.",
      "no-chat",
    );
  }

  const next = await fetchInnertube("next", apiKey, clientVersion, { videoId });
  const conversation = readConversationBar(next);
  if (conversation.message) {
    throw new ChatError(translateChatMessage(conversation.message), "no-chat");
  }
  if (!conversation.token) {
    throw new ChatError(
      "Esse vídeo não devolveu um chat. Use uma live no ar ou uma live encerrada com replay de chat ligado.",
      "no-chat",
    );
  }

  const replay = conversation.replay;
  const token = conversation.token;
  let page: string | null = null;
  const urls = replay
    ? [
        `https://www.youtube.com/live_chat_replay?continuation=${encodeURIComponent(token)}`,
      ]
    : [
        `https://www.youtube.com/live_chat?continuation=${encodeURIComponent(token)}`,
        `https://www.youtube.com/live_chat_replay?continuation=${encodeURIComponent(token)}`,
      ];
  for (const url of urls) {
    try {
      page = await fetchText(url);
      extractSetup(page);
      break;
    } catch (error) {
      if (!(error instanceof ChatError)) throw error;
      page = null;
    }
  }
  if (!page) {
    throw new ChatError(
      "Esse vídeo não devolveu um chat. Use uma live no ar ou uma live encerrada com replay de chat ligado.",
      "no-chat",
    );
  }
  if (
    replay ||
    findContinuation(extractAssignedJson(page, INITIAL_DATA_MARKERS) ?? {}, false)?.mode ===
      "replay"
  ) {
    const liveToken = liveReplayToken(page);
    if (liveToken && liveToken !== token) {
      try {
        const livePage = await fetchText(
          `https://www.youtube.com/live_chat_replay?continuation=${encodeURIComponent(liveToken)}`,
        );
        extractSetup(livePage);
        page = livePage;
      } catch {
        // keep the first replay page (often Top chat)
      }
    }
  }
  return opened(videoId, meta, extractSetup(page));
}

function opened(
  videoId: string,
  meta: { title: string; channel: string },
  setup: ReturnType<typeof extractSetup>,
): OpenedChat {
  return {
    videoId,
    title: meta.title,
    channel: meta.channel,
    mode: setup.continuation.mode,
    apiKey: setup.apiKey,
    clientVersion: setup.clientVersion,
    continuation: setup.continuation.token,
    timeoutMs:
      setup.continuation.mode === "replay"
        ? 500
        : clampTimeout(setup.continuation.timeoutMs),
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
      ...(input.mode === "replay"
        ? { currentPlayerState: { playerOffsetMs: "0" } }
        : {}),
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
    const replay = asRecord(asRecord(action)?.replayChatItemAction)?.actions;
    const nested = Array.isArray(replay) ? replay : [action];
    for (const inner of nested) {
      const item = asRecord(asRecord(inner)?.addChatItemAction)?.item;
      const parsed = item ? parseItem(asRecord(item)) : null;
      if (parsed) messages.push(parsed);
    }
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

function findContinuation(root: unknown, allowReload: boolean): Continuation | null {
  let livePoll: Continuation | null = null;
  let replay: Continuation | null = null;
  let reload: Continuation | null = null;
  const stack: unknown[] = [root];
  let steps = 0;
  while (stack.length > 0 && steps < 250_000) {
    const node = stack.pop();
    steps += 1;
    if (!node || typeof node !== "object") continue;
    const record = asRecord(node);
    if (record) {
      const invalidation = continuationFrom(record, "invalidationContinuationData", "live");
      const timed = continuationFrom(record, "timedContinuationData", "live");
      livePoll ??= invalidation ?? timed;
      replay ??= continuationFrom(record, "liveChatReplayContinuationData", "replay");
      reload ??= continuationFrom(record, "reloadContinuationData", "live", 40);
    }
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return livePoll ?? replay ?? (allowReload ? reload : null);
}

function continuationFrom(
  record: Record<string, unknown>,
  key: string,
  mode: ChatMode,
  minLength = 10,
): Continuation | null {
  const data = asRecord(record[key]);
  if (
    !data ||
    typeof data.continuation !== "string" ||
    data.continuation.length < minLength
  ) {
    return null;
  }
  const timeoutMs = typeof data.timeoutMs === "number" ? data.timeoutMs : 5000;
  return { token: data.continuation, timeoutMs, mode };
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

async function fetchInnertube(
  endpoint: "next",
  apiKey: string,
  clientVersion: string,
  extra: Record<string, unknown>,
): Promise<unknown> {
  const url = `https://www.youtube.com/youtubei/v1/${endpoint}?key=${encodeURIComponent(apiKey)}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {
        ...YOUTUBE_HEADERS,
        "Content-Type": "application/json",
        "X-Youtube-Client-Name": "1",
        "X-Youtube-Client-Version": clientVersion,
      },
      body: JSON.stringify({
        context: {
          client: {
            hl: "pt",
            gl: "BR",
            clientName: "WEB",
            clientVersion,
          },
        },
        ...extra,
      }),
    });
    if (!response.ok) {
      throw new ChatError(
        `O YouTube não abriu os dados do vídeo (${response.status}).`,
        "upstream",
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ChatError) throw error;
    throw new ChatError("Não consegui falar com o YouTube agora.", "upstream");
  }
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
