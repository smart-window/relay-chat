import type { Metadata } from "next";
import ChatApp from "./ChatApp";

export const metadata: Metadata = {
  title: "Relay — Conversations, closer",
  description: "Private text, image, audio, voice, and video conversations in one calm space.",
};

export default function Home() {
  return <ChatApp />;
}
