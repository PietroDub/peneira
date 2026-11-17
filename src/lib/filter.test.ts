import assert from "node:assert/strict";
import test from "node:test";
import { messageMatches, type ChatFilter } from "./filter";
import type { ChatMessage } from "./youtube";

const base: ChatFilter = {
  terms: "",
  authors: "",
  match: "any",
  kinds: ["text", "superchat", "sticker", "member", "gift"],
  minAmount: "",
  caseSensitive: false,
};

function message(patch: Partial<ChatMessage>): ChatMessage {
  return {
    id: "1",
    kind: "text",
    author: "Ana",
    badges: [],
    text: "olá código ABC",
    timestampUsec: "0",
    ...patch,
  };
}

test("sem termo, a mensagem dos tipos marcados passa", () => {
  assert.equal(messageMatches(message({}), base), true);
  assert.equal(
    messageMatches(message({ kind: "system", text: "diga oi" }), base),
    false,
  );
});

test("qualquer palavra, todas as palavras e frase", () => {
  assert.equal(
    messageMatches(message({}), { ...base, terms: "código\nsalve", match: "any" }),
    true,
  );
  assert.equal(
    messageMatches(message({}), { ...base, terms: "código salve", match: "all" }),
    false,
  );
  assert.equal(
    messageMatches(message({}), {
      ...base,
      terms: "código ABC",
      match: "phrase",
    }),
    true,
  );
  assert.equal(
    messageMatches(message({}), {
      ...base,
      terms: "código XYZ",
      match: "phrase",
    }),
    false,
  );
});

test("autor e valor mínimo do super chat", () => {
  assert.equal(
    messageMatches(message({ author: "Ana Clara" }), { ...base, authors: "clara" }),
    true,
  );
  const paid = message({
    kind: "superchat",
    text: "oi",
    amountText: "R$ 20,00",
    amountValue: 20,
  });
  assert.equal(messageMatches(paid, { ...base, minAmount: "15" }), true);
  assert.equal(messageMatches(paid, { ...base, minAmount: "50" }), false);
  assert.equal(messageMatches(message({}), { ...base, minAmount: "10" }), false);
});
