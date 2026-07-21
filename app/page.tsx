import type { Metadata } from "next";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import ChatApp from "./ChatApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Relay — Conversations, closer",
  description: "Private text, image, audio, voice, and video conversations in one calm space.",
};

export default async function Home() {
  const user = await getChatGPTUser();
  if (user) return <ChatApp identityName={user.displayName} />;

  return (
    <main className="landing">
      <nav className="landing-nav" aria-label="Main navigation">
        <a className="brand brand-dark" href="#top" aria-label="Relay home">
          <span className="brand-mark">R</span><span>relay</span>
        </a>
        <a className="nav-signin" href={chatGPTSignInPath("/")}>Sign in</a>
      </nav>
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Your people, one tap away</p>
          <h1>Talk like you’re<br />in the same room.</h1>
          <p className="hero-lede">
            Messages, moments, and face-to-face calls in one beautifully simple place.
            Relay is free to join and built for the conversations that matter.
          </p>
          <div className="hero-actions">
            <a className="primary-cta" href={chatGPTSignInPath("/")}>Create your free account <span>→</span></a>
            <span className="microcopy">No card. No clutter.</span>
          </div>
        </div>
        <div className="hero-visual" aria-label="Relay conversation preview">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="phone-card">
            <div className="phone-top"><span className="avatar coral">M</span><div><strong>Maya</strong><small>online now</small></div><button aria-label="Start video call">◉</button></div>
            <div className="sample-chat">
              <div className="sample-day">TODAY</div>
              <div className="bubble received">The light is perfect here ✨<small>10:41</small></div>
              <div className="sample-image"><div className="sun" /><div className="ridge ridge-a"/><div className="ridge ridge-b"/></div>
              <div className="bubble sent">Save me a seat?<small>10:43 · read</small></div>
              <div className="voice-note"><button aria-label="Play voice message">▶</button><div className="wave">▂▄▅▃▇▅▂▄▆▃▅▇▂▄</div><span>0:18</span></div>
            </div>
            <div className="sample-composer"><span>Write a message…</span><b>↑</b></div>
          </div>
          <div className="float-pill pill-call"><span>●</span> Crystal-clear calls</div>
          <div className="float-pill pill-private">✦ Private by design</div>
        </div>
      </section>
      <section className="feature-strip" aria-label="Relay features">
        <article><span>01</span><h2>Say it your way</h2><p>Text, photos, and voice notes—share what words alone can’t.</p></article>
        <article><span>02</span><h2>Feel closer</h2><p>Jump into crisp voice or video calls without links or scheduling.</p></article>
        <article><span>03</span><h2>Keep it yours</h2><p>Your media stays private and every conversation is account-protected.</p></article>
      </section>
    </main>
  );
}
