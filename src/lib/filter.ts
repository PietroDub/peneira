import type { ChatKind, ChatMessage } from "./youtube";

export type MatchMode = "any" | "all" | "phrase";

export type ChatFilter = {
  terms: string;
  authors: string;
  match: MatchMode;
  kinds: ChatKind[];
  minAmount: string;
  caseSensitive: boolean;
};

export const DEFAULT_KINDS: ChatKind[] = [
  "text",
  "superchat",
  "sticker",
  "member",
  "gift",
];

export const EMPTY_FILTER: ChatFilter = {
  terms: "",
  authors: "",
  match: "any",
  kinds: DEFAULT_KINDS,
  minAmount: "",
  caseSensitive: false,
};

export function hasTextCriteria(filter: ChatFilter): boolean {
  return (
    splitList(filter.terms).length > 0 ||
    splitList(filter.authors).length > 0 ||
    amountFloor(filter) > 0
  );
}

export function messageMatches(message: ChatMessage, filter: ChatFilter): boolean {
  if (filter.kinds.length > 0 && !filter.kinds.includes(message.kind)) return false;

  const floor = amountFloor(filter);
  if (floor > 0 && (message.amountValue == null || message.amountValue < floor)) {
    return false;
  }

  const authors = splitList(filter.authors);
  if (authors.length > 0) {
    const name = fold(message.author, filter.caseSensitive);
    const hit = authors.some((author) =>
      name.includes(fold(author, filter.caseSensitive)),
    );
    if (!hit) return false;
  }

  const lines = splitList(filter.terms);
  if (lines.length === 0) return true;

  const haystack = fold(message.text, filter.caseSensitive);
  if (filter.match === "phrase") {
    return lines.some((line) => haystack.includes(fold(line, filter.caseSensitive)));
  }

  const words = lines
    .flatMap((line) => line.split(/\s+/))
    .map((word) => fold(word, filter.caseSensitive))
    .filter(Boolean);
  if (words.length === 0) return true;
  if (filter.match === "all") return words.every((word) => haystack.includes(word));
  return words.some((word) => haystack.includes(word));
}

function amountFloor(filter: ChatFilter): number {
  const parsed = Number(filter.minAmount.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function fold(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLocaleLowerCase("pt-BR");
}
