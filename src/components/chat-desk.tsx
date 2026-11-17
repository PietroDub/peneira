"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  EMPTY_FILTER,
  hasTextCriteria,
  messageMatches,
  type ChatFilter,
  type MatchMode,
} from "@/lib/filter";
import type { ChatKind, ChatMessage, OpenedChat } from "@/lib/youtube";

const KIND_OPTIONS: Array<{ id: ChatKind; label: string }> = [
  { id: "text", label: "Texto" },
  { id: "superchat", label: "Super Chat" },
  { id: "sticker", label: "Figurinha" },
  { id: "member", label: "Membro" },
  { id: "gift", label: "Presente" },
  { id: "system", label: "Aviso" },
];

const STORAGE_KEY = "peneira-filtro";
const BUFFER_LIMIT = 2500;

type Phase = "idle" | "opening" | "live" | "replay" | "ended" | "error";

export function ChatDesk() {
  const stored = useState(readStored)[0];
  const [link, setLink] = useState("");
  const [filter, setFilter] = useState<ChatFilter>(stored.filter);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [session, setSession] = useState<OpenedChat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlyMatches, setOnlyMatches] = useState(stored.onlyMatches);
  const [sound, setSound] = useState(stored.sound);
  const [seen, setSeen] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const seenIds = useRef(new Set<string>());
  const filterRef = useRef(filter);
  const soundRef = useRef(sound);
  const runRef = useRef(0);

  useEffect(() => {
    filterRef.current = filter;
    soundRef.current = sound;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...filter, onlyMatches, sound }));
  }, [filter, sound, onlyMatches]);

  const hits = useMemo(
    () => messages.filter((message) => messageMatches(message, filter)),
    [messages, filter],
  );
  const visible = onlyMatches ? hits : messages;
  const narrowed = hasTextCriteria(filter);

  useEffect(() => {
    const node = listRef.current;
    if (!node || !stickRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [visible]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function patchFilter(patch: Partial<ChatFilter>) {
    setFilter((current) => ({ ...current, ...patch }));
  }

  function toggleKind(kind: ChatKind) {
    setFilter((current) => {
      const has = current.kinds.includes(kind);
      const kinds = has
        ? current.kinds.filter((item) => item !== kind)
        : [...current.kinds, kind];
      return { ...current, kinds };
    });
  }

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (phase === "live" || phase === "replay" || phase === "opening") {
      stop();
      return;
    }
    runRef.current += 1;
    const runId = runRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("opening");
    setError("");
    setMessages([]);
    setSeen(0);
    seenIds.current = new Set();
    setSession(null);

    try {
      const response = await fetch("/api/chat/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: link }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as OpenedChat & { error?: string };
      if (runRef.current !== runId) return;
      if (!response.ok) {
        setPhase("error");
        setError(payload.error ?? "Não abri o chat.");
        return;
      }
      const seeded = payload.messages ?? [];
      for (const message of seeded) seenIds.current.add(message.id);
      setMessages(sortMessages(seeded).slice(-BUFFER_LIMIT));
      setSeen(seeded.length);
      setSession(payload);
      setPhase(payload.mode === "replay" ? "replay" : "live");
      void pollLoop(payload, controller, runId);
    } catch (cause) {
      if (controller.signal.aborted || runRef.current !== runId) return;
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "Não abri o chat.");
    }
  }

  async function pollLoop(opened: OpenedChat, controller: AbortController, runId: number) {
    let continuation = opened.continuation;
    let timeoutMs = opened.timeoutMs;
    let failures = 0;

    while (runRef.current === runId && !controller.signal.aborted) {
      await sleep(timeoutMs, controller.signal);
      if (runRef.current !== runId || controller.signal.aborted) return;
      try {
        const response = await fetch("/api/chat/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            apiKey: opened.apiKey,
            clientVersion: opened.clientVersion,
            continuation,
            mode: opened.mode,
          }),
        });
        const payload = (await response.json()) as {
          messages?: ChatMessage[];
          continuation?: string | null;
          timeoutMs?: number;
          ended?: boolean;
          error?: string;
        };
        if (runRef.current !== runId || controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(payload.error ?? "Falha ao ler o chat.");
        }
        failures = 0;
        const incoming = payload.messages ?? [];
        const fresh = incoming.filter((message) => {
          if (seenIds.current.has(message.id)) return false;
          seenIds.current.add(message.id);
          return true;
        });
        if (fresh.length > 0 && runRef.current === runId) {
          setSeen((count) => count + fresh.length);
          setMessages((current) =>
            sortMessages([...current, ...fresh]).slice(-BUFFER_LIMIT),
          );
          if (
            soundRef.current &&
            fresh.some((message) => messageMatches(message, filterRef.current))
          ) {
            beep();
          }
        }
        if (runRef.current !== runId) return;
        if (payload.ended || !payload.continuation) {
          setPhase("ended");
          return;
        }
        continuation = payload.continuation;
        timeoutMs = payload.timeoutMs ?? timeoutMs;
      } catch (cause) {
        if (controller.signal.aborted || runRef.current !== runId) return;
        failures += 1;
        setError(cause instanceof Error ? cause.message : "Falha ao ler o chat.");
        if (failures >= 4) {
          setPhase("error");
          return;
        }
        timeoutMs = Math.min(15_000, timeoutMs + 2000);
      }
    }
  }

  function stop() {
    runRef.current += 1;
    abortRef.current?.abort();
    setPhase("idle");
    setError("");
    setSession(null);
  }

  function copyHits() {
    const lines = hits.map(formatLine).join("\n");
    void navigator.clipboard.writeText(lines);
  }

  function downloadHits() {
    const blob = new Blob([JSON.stringify(hits, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `peneira-${session?.videoId ?? "chat"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const status = statusLabel(phase, error);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5 md:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-heading text-2xl tracking-tight">Peneira</p>
          <Badge variant="outline">{status}</Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Lê o chat público de uma live do YouTube — no ar ou encerrada, se
          houver replay — e separa as mensagens que batem no que você marcou:
          palavra, autor ou Super Chat.
        </p>
      </header>

      <form onSubmit={connect} className="flex flex-col gap-2 sm:flex-row">
        <Label className="sr-only" htmlFor="live-link">
          Link da live
        </Label>
        <Input
          id="live-link"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=… ou código do vídeo"
          className="h-10 sm:flex-1"
          autoComplete="off"
        />
        <Button
          type="submit"
          variant={phase === "live" || phase === "replay" || phase === "opening" ? "outline" : "default"}
          className="h-10"
          disabled={phase === "idle" && !link.trim()}
        >
          {phase === "opening" ? "Abrindo…" : phase === "live" || phase === "replay" ? "Parar" : "Abrir chat"}
        </Button>
      </form>

      {session ? (
        <p className="text-sm">
          <a
            className="underline decoration-foreground/30 underline-offset-4"
            href={`https://www.youtube.com/watch?v=${session.videoId}`}
            target="_blank"
            rel="noreferrer"
          >
            {session.title}
          </a>
          {session.channel ? (
            <span className="text-muted-foreground"> · {session.channel}</span>
          ) : null}
        </p>
      ) : null}

      {error && phase !== "idle" ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid flex-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex flex-col gap-2">
            <Label htmlFor="terms">Termos</Label>
            <textarea
              id="terms"
              value={filter.terms}
              onChange={(event) => patchFilter({ terms: event.target.value })}
              placeholder={"código\ngiveaway\nmanda salve"}
              rows={5}
              className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["any", "Qualquer"],
                  ["all", "Todas"],
                  ["phrase", "Frase"],
                ] as Array<[MatchMode, string]>
              ).map(([mode, label]) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={filter.match === mode ? "default" : "outline"}
                  onClick={() => patchFilter({ match: mode })}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Um termo por linha. Qualquer acha uma palavra. Todas exigem cada
              palavra. Frase procura o texto inteiro da linha.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="authors">Autores</Label>
            <Input
              id="authors"
              value={filter.authors}
              onChange={(event) => patchFilter({ authors: event.target.value })}
              placeholder="ana, canal"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="min-amount">Super Chat mínimo</Label>
            <Input
              id="min-amount"
              inputMode="decimal"
              value={filter.minAmount}
              onChange={(event) => patchFilter({ minAmount: event.target.value })}
              placeholder="20"
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Tipos</legend>
            <div className="flex flex-wrap gap-1">
              {KIND_OPTIONS.map((option) => {
                const on = filter.kinds.includes(option.id);
                return (
                  <Button
                    key={option.id}
                    type="button"
                    size="sm"
                    variant={on ? "secondary" : "outline"}
                    aria-pressed={on}
                    onClick={() => toggleKind(option.id)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="case">Diferenciar maiúsculas</Label>
            <Switch
              id="case"
              checked={filter.caseSensitive}
              onCheckedChange={(checked) => patchFilter({ caseSensitive: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="only">Só o que bater</Label>
            <Switch
              id="only"
              checked={onlyMatches}
              onCheckedChange={setOnlyMatches}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="sound">Som no acerto</Label>
            <Switch id="sound" checked={sound} onCheckedChange={setSound} />
          </div>
        </aside>

        <section className="flex min-h-[420px] flex-col rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="text-sm">
              <span className="font-medium">{hits.length}</span>
              <span className="text-muted-foreground"> bateram</span>
              <span className="text-muted-foreground"> · {seen} lidas</span>
            </p>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="outline" onClick={copyHits} disabled={hits.length === 0}>
                Copiar
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={downloadHits} disabled={hits.length === 0}>
                Baixar JSON
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMessages([]);
                  setSeen(0);
                }}
                disabled={messages.length === 0}
              >
                Limpar
              </Button>
            </div>
          </div>
          <div
            ref={listRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              stickRef.current =
                node.scrollHeight - node.scrollTop - node.clientHeight < 64;
            }}
            className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2"
          >
            {visible.length === 0 ? (
              <EmptyState phase={phase} narrowed={narrowed} onlyMatches={onlyMatches} />
            ) : (
              visible.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  terms={filter.terms}
                  match={filter.match}
                  caseSensitive={filter.caseSensitive}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function EmptyState({
  phase,
  narrowed,
  onlyMatches,
}: {
  phase: Phase;
  narrowed: boolean;
  onlyMatches: boolean;
}) {
  let text = "Cole o link de uma live no ar ou de uma live encerrada com replay de chat.";
  if (phase === "opening") text = "Abrindo o chat ao vivo ou o replay gravado.";
  else if (phase === "live") {
    text = narrowed && onlyMatches
      ? "Nada bateu ainda. A lista enche quando chegar uma mensagem do filtro."
      : "O chat está aberto. As mensagens aparecem aqui conforme chegam.";
  } else if (phase === "replay") {
    text = narrowed && onlyMatches
      ? "Nada bateu ainda neste trecho do replay."
      : "Lendo o replay do chat. As mensagens antigas entram em sequência.";
  } else if (phase === "ended") text = "O chat (ou o replay) acabou. O que já passou continua na lista se você não limpou.";
  else if (phase === "error") text = "A leitura parou. Confira o aviso acima e abra de novo.";
  return <p className="px-3 py-8 text-sm text-muted-foreground">{text}</p>;
}

function MessageRow({
  message,
  terms,
  match,
  caseSensitive,
}: {
  message: ChatMessage;
  terms: string;
  match: MatchMode;
  caseSensitive: boolean;
}) {
  const time = formatTime(message.timestampUsec);
  return (
    <article
      className="rounded-lg px-3 py-2 text-sm odd:bg-muted/40"
      style={message.color ? { boxShadow: `inset 3px 0 0 ${message.color}` } : undefined}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <time className="font-mono text-[11px] text-muted-foreground" dateTime={time.iso}>
          {time.label}
        </time>
        <span className="font-medium">{message.author}</span>
        <KindBadge kind={message.kind} amount={message.amountText} />
        {message.badges.map((badge) => (
          <Badge key={badge} variant="outline">
            {badge}
          </Badge>
        ))}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words">
        <Highlight text={message.text} terms={terms} match={match} caseSensitive={caseSensitive} />
      </p>
    </article>
  );
}

function KindBadge({ kind, amount }: { kind: ChatKind; amount?: string }) {
  if (kind === "text") return null;
  const label =
    kind === "superchat"
      ? amount || "Super Chat"
      : kind === "sticker"
        ? amount || "Figurinha"
        : kind === "member"
          ? "Membro"
          : kind === "gift"
            ? "Presente"
            : "Aviso";
  return <Badge variant={kind === "superchat" ? "default" : "secondary"}>{label}</Badge>;
}

function Highlight({
  text,
  terms,
  match,
  caseSensitive,
}: {
  text: string;
  terms: string;
  match: MatchMode;
  caseSensitive: boolean;
}) {
  const needles = highlightNeedles(terms, match);
  if (needles.length === 0) return text;
  const source = needles.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|");
  const flags = caseSensitive ? "g" : "gi";
  const expression = new RegExp(`(${source})`, flags);
  const parts = text.split(expression);
  if (parts.length === 1) return text;
  return parts.map((part, index) => {
    const hit = needles.some((needle) =>
      caseSensitive ? part === needle : part.toLocaleLowerCase("pt-BR") === needle.toLocaleLowerCase("pt-BR"),
    );
    if (!hit) return <span key={index}>{part}</span>;
    return (
      <mark key={index} className="rounded bg-primary/25 px-0.5 text-foreground">
        {part}
      </mark>
    );
  });
}

function highlightNeedles(terms: string, match: MatchMode): string[] {
  const lines = terms
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (match === "phrase") return lines;
  return lines.flatMap((line) => line.split(/\s+/)).filter(Boolean);
}

function formatLine(message: ChatMessage): string {
  const time = formatTime(message.timestampUsec).label;
  const amount = message.amountText ? ` (${message.amountText})` : "";
  return `${time} ${message.author}${amount}: ${message.text}`;
}

function formatTime(timestampUsec: string): { label: string; iso: string } {
  const millis = Number(timestampUsec) / 1000;
  if (!Number.isFinite(millis) || millis <= 0) return { label: "--:--", iso: "" };
  const date = new Date(millis);
  return {
    iso: date.toISOString(),
    label: date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

function statusLabel(phase: Phase, error: string): string {
  if (phase === "opening") return "abrindo";
  if (phase === "live") return error ? "ao vivo, com falha" : "ao vivo";
  if (phase === "replay") return "replay";
  if (phase === "ended") return "chat encerrado";
  if (phase === "error") return "parou";
  return "parado";
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function beep() {
  const Context = window.AudioContext;
  if (!Context) return;
  const audio = new Context();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 740;
  gain.gain.value = 0.05;
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
  oscillator.stop(audio.currentTime + 0.2);
  oscillator.onended = () => void audio.close();
}

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort(
    (left, right) => Number(left.timestampUsec) - Number(right.timestampUsec),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KINDS = new Set<ChatKind>(KIND_OPTIONS.map((option) => option.id));

function readStored(): { filter: ChatFilter; onlyMatches: boolean; sound: boolean } {
  const fallback = { filter: EMPTY_FILTER, onlyMatches: true, sound: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<ChatFilter> & {
      onlyMatches?: boolean;
      sound?: boolean;
    };
    const kinds = Array.isArray(saved.kinds)
      ? saved.kinds.filter((kind): kind is ChatKind => KINDS.has(kind as ChatKind))
      : EMPTY_FILTER.kinds;
    const match: MatchMode =
      saved.match === "all" || saved.match === "phrase" || saved.match === "any"
        ? saved.match
        : "any";
    return {
      filter: {
        ...EMPTY_FILTER,
        ...saved,
        match,
        kinds,
        terms: typeof saved.terms === "string" ? saved.terms : "",
        authors: typeof saved.authors === "string" ? saved.authors : "",
        minAmount: typeof saved.minAmount === "string" ? saved.minAmount : "",
        caseSensitive: saved.caseSensitive === true,
      },
      onlyMatches: typeof saved.onlyMatches === "boolean" ? saved.onlyMatches : true,
      sound: saved.sound === true,
    };
  } catch {
    return fallback;
  }
}
