"use client";

import dynamic from "next/dynamic";

const ChatDesk = dynamic(
  () => import("@/components/chat-desk").then((mod) => mod.ChatDesk),
  {
    ssr: false,
    loading: () => (
      <p className="px-6 py-8 text-sm text-muted-foreground">Abrindo a peneira…</p>
    ),
  },
);

export default function Home() {
  return <ChatDesk />;
}
