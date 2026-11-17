import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSetup,
  parsePollBody,
  parseVideoId,
  readConversationBar,
} from "./youtube";

const PAGE = `
ytcfg.set({"INNERTUBE_API_KEY":"AIzaSyTESTKEY123456","INNERTUBE_CLIENT_VERSION":"2.20251101.00.00"});
ytInitialData = {"contents":{"liveChatRenderer":{"continuations":[{"invalidationContinuationData":{"continuation":"TOKEN1234567890abcdef","timeoutMs":4981}}]}}};
`;

test("parseVideoId aceita link, short e código", () => {
  assert.equal(parseVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(
    parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12"),
    "dQw4w9WgXcQ",
  );
  assert.equal(parseVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(
    parseVideoId("https://www.youtube.com/live/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(parseVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseVideoId("não é um vídeo"), null);
});

test("extractSetup lê a chave e o token da página do chat", () => {
  const setup = extractSetup(PAGE);
  assert.equal(setup.apiKey, "AIzaSyTESTKEY123456");
  assert.equal(setup.clientVersion, "2.20251101.00.00");
  assert.equal(setup.continuation.token, "TOKEN1234567890abcdef");
  assert.equal(setup.continuation.mode, "live");
  assert.equal(setup.continuation.timeoutMs, 4981);
});

test("parsePollBody separa texto, super chat e ignora ticker", () => {
  const batch = parsePollBody({
    continuationContents: {
      liveChatContinuation: {
        actions: [
          {
            addChatItemAction: {
              item: {
                liveChatTextMessageRenderer: {
                  id: "m1",
                  timestampUsec: "1731850000000000",
                  authorName: { simpleText: "Ana" },
                  authorBadges: [
                    { liveChatAuthorBadgeRenderer: { tooltip: "Membro" } },
                  ],
                  message: {
                    runs: [
                      { text: "olá " },
                      { emoji: { shortcuts: [":smile:"], emojiId: "smile" } },
                      { text: " código ABC" },
                    ],
                  },
                },
              },
            },
          },
          {
            addLiveChatTickerItemAction: {
              item: {
                liveChatTickerPaidMessageItemRenderer: {
                  id: "ticker",
                  authorName: { simpleText: "Bia" },
                },
              },
            },
          },
          {
            addChatItemAction: {
              item: {
                liveChatPaidMessageRenderer: {
                  id: "m2",
                  timestampUsec: "1731850001000000",
                  authorName: { simpleText: "Bia" },
                  message: { simpleText: "manda salve" },
                  purchaseAmountText: { simpleText: "R$ 20,00" },
                  bodyBackgroundColor: 4281523142,
                },
              },
            },
          },
        ],
        continuations: [
          {
            timedContinuationData: {
              continuation: "NEXTTOKEN123456789",
              timeoutMs: 5000,
            },
          },
        ],
      },
    },
  });

  assert.equal(batch.messages.length, 2);
  assert.equal(batch.messages[0]?.text, "olá :smile: código ABC");
  assert.deepEqual(batch.messages[0]?.badges, ["Membro"]);
  assert.equal(batch.messages[1]?.kind, "superchat");
  assert.equal(batch.messages[1]?.amountValue, 20);
  assert.match(batch.messages[1]?.color ?? "", /^#[0-9a-f]{6}$/);
  assert.equal(batch.continuation, "NEXTTOKEN123456789");
  assert.equal(batch.ended, false);
});

test("extractSetup lê o replay em window[ytInitialData]", () => {
  const page = `
ytcfg.set({"INNERTUBE_API_KEY":"AIzaSyTESTKEY123456","INNERTUBE_CLIENT_VERSION":"2.20251101.00.00"});
window["ytInitialData"] = {"continuationContents":{"liveChatContinuation":{"actions":[{"replayChatItemAction":{"actions":[{"addChatItemAction":{"item":{"liveChatTextMessageRenderer":{"id":"r1","timestampUsec":"1","authorName":{"simpleText":"Cris"},"message":{"simpleText":"quando acaba"}}}}}]}}],"continuations":[{"liveChatReplayContinuationData":{"continuation":"REPLAYTOKEN1234567890","timeoutMs":5000}}]}}};
`;
  const setup = extractSetup(page);
  assert.equal(setup.continuation.mode, "replay");
  assert.equal(setup.continuation.token, "REPLAYTOKEN1234567890");
  assert.equal(setup.continuation.timeoutMs, 500);
  assert.equal(setup.messages[0]?.text, "quando acaba");
});

test("readConversationBar distingue replay, live e chat desligado", () => {
  const replay = readConversationBar({
    contents: {
      twoColumnWatchNextResults: {
        conversationBar: {
          liveChatRenderer: {
            header: {
              liveChatHeaderRenderer: {
                viewSelector: {
                  sortFilterSubMenuRenderer: {
                    subMenuItems: [
                      { title: "Top chat replay" },
                      { title: "Live chat replay" },
                    ],
                  },
                },
              },
            },
            continuations: [
              {
                reloadContinuationData: {
                  continuation: "BASETOKEN1234567890abcdefXXXXLONGTOKEN1234567890",
                },
              },
            ],
          },
        },
      },
    },
  });
  assert.equal(replay.replay, true);
  assert.equal(replay.token, "BASETOKEN1234567890abcdefXXXXLONGTOKEN1234567890");

  const off = readConversationBar({
    contents: {
      twoColumnWatchNextResults: {
        conversationBar: {
          conversationBarRenderer: {
            availabilityMessage: {
              messageRenderer: {
                text: { runs: [{ text: "Live chat replay was turned off for this video." }] },
              },
            },
          },
        },
      },
    },
  });
  assert.match(off.message ?? "", /turned off/i);
});

test("parsePollBody lê mensagens dentro de replayChatItemAction", () => {
  const batch = parsePollBody({
    continuationContents: {
      liveChatContinuation: {
        actions: [
          {
            replayChatItemAction: {
              videoOffsetTimeMsec: "1200",
              actions: [
                {
                  addChatItemAction: {
                    item: {
                      liveChatTextMessageRenderer: {
                        id: "r2",
                        timestampUsec: "2",
                        authorName: { simpleText: "Duda" },
                        message: { simpleText: "não gostei" },
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
        continuations: [
          {
            liveChatReplayContinuationData: {
              continuation: "NEXTREPLAYTOKEN123456",
              timeoutMs: 5000,
            },
          },
        ],
      },
    },
  });
  assert.equal(batch.messages[0]?.text, "não gostei");
  assert.equal(batch.continuation, "NEXTREPLAYTOKEN123456");
  assert.equal(batch.timeoutMs, 500);
  assert.equal(batch.ended, false);
});

test("parsePollBody marca o fim quando o token some", () => {
  const batch = parsePollBody({
    continuationContents: { liveChatContinuation: { actions: [] } },
  });
  assert.equal(batch.ended, true);
  assert.equal(batch.continuation, null);
});
