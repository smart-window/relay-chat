"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type User = { id: string; displayName: string; handle: string; bio: string; lastSeen: number };
type Conversation = {
  id: string; kind: string; title: string | null; createdAt: number; peerId: string;
  peerName: string; peerHandle: string; peerLastSeen: number; lastBody: string | null;
  lastKind: string | null; lastMessageAt: number | null;
};
type Message = {
  id: string; senderId: string; senderName: string; kind: "text" | "image" | "audio";
  body: string | null; objectName: string | null; objectType: string | null; createdAt: number;
};
type Call = {
  id: string; conversationId: string; callerId: string; calleeId: string; callerName: string;
  mode: "voice" | "video"; status: "ringing" | "active" | "ended"; offerSdp: string; answerSdp: string | null;
};

const API = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "Request failed");
  return data as T;
};

const initials = (name: string) => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
const relativeTime = (timestamp?: number | null) => {
  if (!timestamp) return "";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
};

function waitForIce(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      if (peer.iceGatheringState === "complete") {
        peer.removeEventListener("icegatheringstatechange", done);
        resolve();
      }
    };
    peer.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, 5000);
  });
}

export default function ChatApp({ identityName }: { identityName: string }) {
  const [me, setMe] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [incoming, setIncoming] = useState<Call | null>(null);
  const [activeCall, setActiveCall] = useState<(Call & { peerName: string }) | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const selected = conversations.find((conversation) => conversation.id === selectedId) || null;

  const closeCall = useCallback(async (notify = true) => {
    const callId = activeCall?.id || incoming?.id;
    if (notify && callId) API("/api/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "end", callId }) }).catch(() => undefined);
    peerRef.current?.close(); peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop()); localStreamRef.current = null;
    setActiveCall(null); setIncoming(null); setMuted(false); setCameraOff(false);
  }, [activeCall?.id, incoming?.id]);

  const refreshConversations = useCallback(async () => {
    const data = await API<{ conversations: Conversation[] }>("/api/conversations");
    setConversations(data.conversations);
    setSelectedId((current) => current || data.conversations[0]?.id || null);
  }, []);

  useEffect(() => {
    Promise.all([API<{ user: User }>("/api/profile"), API<{ conversations: Conversation[] }>("/api/conversations")])
      .then(([profile, conversationData]) => {
        setMe(profile.user);
        setConversations(conversationData.conversations);
        setSelectedId(conversationData.conversations[0]?.id || null);
      })
      .catch((cause) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    const load = () => API<{ messages: Message[] }>(`/api/conversations/${selectedId}/messages`)
      .then((data) => live && setMessages(data.messages))
      .catch(() => undefined);
    load();
    const timer = setInterval(load, 1800);
    return () => { live = false; clearInterval(timer); };
  }, [selectedId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (search.trim().length < 2) return;
    const timer = setTimeout(() => {
      API<{ users: User[] }>(`/api/users?q=${encodeURIComponent(search)}`).then((data) => setResults(data.users)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!me || activeCall) return;
    const poll = () => API<{ call: Call | null }>("/api/calls")
      .then(({ call }) => setIncoming(call?.status === "ringing" ? call : null)).catch(() => undefined);
    poll();
    const timer = setInterval(poll, 2500);
    return () => clearInterval(timer);
  }, [me, activeCall]);

  useEffect(() => {
    if (!activeCall) return;
    const timer = setInterval(async () => {
      const { call } = await API<{ call: Call | null }>(`/api/calls?callId=${activeCall.id}`).catch(() => ({ call: null }));
      if (!call || call.status === "ended") return closeCall(false);
      if (call.answerSdp && peerRef.current && !peerRef.current.remoteDescription) {
        await peerRef.current.setRemoteDescription(JSON.parse(call.answerSdp));
        setActiveCall((current) => current ? { ...current, status: "active" } : current);
      }
    }, 1400);
    return () => clearInterval(timer);
  }, [activeCall, closeCall]);

  const openConversation = (id: string) => {
    setSelectedId(id);
    setMobileSidebar(false);
  };

  const startConversation = async (userId: string) => {
    const { id } = await API<{ id: string }>("/api/conversations", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
    });
    await refreshConversations();
    openConversation(id);
    setShowSearch(false); setSearch(""); setResults([]);
  };

  const send = async (body = draft, uploadId?: string) => {
    if (!selectedId || (!body.trim() && !uploadId)) return;
    setSending(true); setError("");
    try {
      await API(`/api/conversations/${selectedId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, uploadId }),
      });
      setDraft("");
      const data = await API<{ messages: Message[] }>(`/api/conversations/${selectedId}/messages`);
      setMessages(data.messages);
      await refreshConversations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send message");
    } finally { setSending(false); }
  };

  const uploadFile = async (file: File) => {
    setSending(true); setError("");
    try {
      const form = new FormData(); form.append("file", file);
      const upload = await API<{ uploadId: string }>("/api/uploads", { method: "POST", body: form });
      await send("", upload.uploadId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
      setSending(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) { recorderRef.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        uploadFile(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type }));
      };
      recorder.start(); recorderRef.current = recorder; setRecording(true);
    } catch { setError("Microphone permission is needed to record a voice note."); }
  };

  const preparePeer = async (mode: "voice" | "video") => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }] });
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.ontrack = (event) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0]; };
    peer.onconnectionstatechange = () => { if (["failed", "closed"].includes(peer.connectionState)) closeCall(false); };
    peerRef.current = peer; localStreamRef.current = stream;
    requestAnimationFrame(() => { if (localVideoRef.current) localVideoRef.current.srcObject = stream; });
    return peer;
  };

  const startCall = async (mode: "voice" | "video") => {
    if (!selected || !me) return;
    try {
      const peer = await preparePeer(mode);
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIce(peer);
      const { id } = await API<{ id: string }>("/api/calls", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", conversationId: selected.id, mode, sdp: JSON.stringify(peer.localDescription) }),
      });
      setActiveCall({ id, conversationId: selected.id, callerId: me.id, calleeId: selected.peerId, callerName: me.displayName, peerName: selected.peerName, mode, status: "ringing", offerSdp: JSON.stringify(peer.localDescription), answerSdp: null });
    } catch { closeCall(false); setError("Camera or microphone access is needed to start a call."); }
  };

  const answerCall = async () => {
    if (!incoming) return;
    try {
      const peer = await preparePeer(incoming.mode);
      await peer.setRemoteDescription(JSON.parse(incoming.offerSdp));
      await peer.setLocalDescription(await peer.createAnswer());
      await waitForIce(peer);
      await API("/api/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "answer", callId: incoming.id, sdp: JSON.stringify(peer.localDescription) }) });
      setActiveCall({ ...incoming, peerName: incoming.callerName, status: "active" }); setIncoming(null);
    } catch { setError("Could not connect the call. Check your camera and microphone permissions."); }
  };

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMuted(!track.enabled); }
  };
  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setCameraOff(!track.enabled); }
  };

  if (!me) return <div className="app-loading"><span className="brand-mark">R</span><p>{error || `Opening Relay for ${identityName}…`}</p></div>;

  return (
    <main className="chat-shell">
      <aside className={`sidebar ${mobileSidebar ? "mobile-open" : ""}`}>
        <header className="sidebar-header">
          <a className="brand" href="#" aria-label="Relay home"><span className="brand-mark">R</span><span>relay</span></a>
          <button className="round-btn" onClick={() => setShowSearch(true)} aria-label="Start a new conversation">＋</button>
        </header>
        <div className="sidebar-label"><span>Messages</span><span>{conversations.length}</span></div>
        <div className="conversation-list">
          {conversations.length === 0 && <button className="empty-conversations" onClick={() => setShowSearch(true)}><b>Your inbox is ready.</b><span>Find someone by name or @handle to start talking.</span><em>Start a conversation →</em></button>}
          {conversations.map((conversation, index) => (
            <button key={conversation.id} className={`conversation-row ${selectedId === conversation.id ? "active" : ""}`} onClick={() => openConversation(conversation.id)}>
              <span className={`avatar avatar-${index % 4}`}>{initials(conversation.peerName)}</span>
              <span className="conversation-copy"><span><strong>{conversation.peerName}</strong><time>{relativeTime(conversation.lastMessageAt)}</time></span><small>{conversation.lastKind === "image" ? "▧ Photo" : conversation.lastKind === "audio" ? "♪ Voice message" : conversation.lastBody || `@${conversation.peerHandle}`}</small></span>
            </button>
          ))}
        </div>
        <button className="profile-chip" onClick={() => setShowProfile(true)}>
          <span className="avatar avatar-me">{initials(me.displayName)}</span><span><strong>{me.displayName}</strong><small>@{me.handle}</small></span><b>•••</b>
        </button>
      </aside>

      <section className={`chat-pane ${mobileSidebar ? "mobile-hidden" : ""}`}>
        {selected ? <>
          <header className="chat-header">
            <button className="mobile-back" onClick={() => setMobileSidebar(true)} aria-label="Back to conversations">←</button>
            <span className="avatar avatar-1">{initials(selected.peerName)}</span>
            <span className="chat-person"><strong>{selected.peerName}</strong><small><i className={relativeTime(selected.peerLastSeen) === "now" ? "online" : ""} />{relativeTime(selected.peerLastSeen) === "now" ? "Online" : `Last seen ${relativeTime(selected.peerLastSeen)} ago`}</small></span>
            <div className="call-actions"><button onClick={() => startCall("voice")} aria-label="Start voice call">☎</button><button onClick={() => startCall("video")} aria-label="Start video call">▣</button></div>
          </header>
          <div className="message-list" ref={listRef}>
            {messages.length === 0 && <div className="conversation-begin"><span className="avatar avatar-1 large">{initials(selected.peerName)}</span><h2>Say hello to {selected.peerName}</h2><p>This is the beginning of your conversation. Share a thought, photo, or voice note.</p></div>}
            {messages.map((message, index) => {
              const mine = message.senderId === me.id;
              const showName = !mine && messages[index - 1]?.senderId !== message.senderId;
              return <div className={`message ${mine ? "mine" : "theirs"}`} key={message.id}>
                {showName && <small className="sender-name">{message.senderName}</small>}
                {/* Private message media is served by an authenticated route, so it bypasses the public image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {message.kind === "image" && <div className="image-message"><img src={`/api/media/${message.id}`} alt={message.objectName || "Shared image"} /><time>{relativeTime(message.createdAt)}</time></div>}
                {message.kind === "audio" && <div className="audio-message"><span>♪</span><audio controls preload="metadata" src={`/api/media/${message.id}`} /><time>{relativeTime(message.createdAt)}</time></div>}
                {message.kind === "text" && <div className="text-message"><span>{message.body}</span><time>{relativeTime(message.createdAt)}</time></div>}
              </div>;
            })}
          </div>
          {error && <div className="error-toast" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}
          <form className="composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <input ref={fileRef} type="file" accept="image/*,audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadFile(file); event.currentTarget.value = ""; }} />
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach image or audio">＋</button>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${selected.peerName}`} aria-label="Message" maxLength={4000} />
            <button type="button" className={recording ? "recording" : ""} onClick={toggleRecording} aria-label={recording ? "Stop recording" : "Record voice note"}>{recording ? "■" : "●"}</button>
            <button className="send-btn" disabled={sending || !draft.trim()} aria-label="Send message">↑</button>
          </form>
        </> : <div className="no-chat"><div className="no-chat-mark">R</div><h1>Your conversations,<br /><em>right here.</em></h1><p>Find a friend and start with a message.</p><button onClick={() => setShowSearch(true)}>Start a conversation</button></div>}
      </section>

      {showSearch && <div className="modal-backdrop" onMouseDown={() => setShowSearch(false)}><section className="modal search-modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-label="New conversation"><button className="modal-close" onClick={() => setShowSearch(false)}>×</button><p className="eyebrow">New conversation</p><h2>Who’s on your mind?</h2><label className="search-field"><span>⌕</span><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or @handle" /></label><div className="search-results">{search.length < 2 && <p>Type at least two characters to find someone on Relay.</p>}{search.length >= 2 && results.length === 0 && <p>No matches yet. They may need to create a Relay account first.</p>}{results.map((user) => <button key={user.id} onClick={() => startConversation(user.id)}><span className="avatar avatar-2">{initials(user.displayName)}</span><span><strong>{user.displayName}</strong><small>@{user.handle}</small></span><b>Message →</b></button>)}</div></section></div>}

      {showProfile && <ProfileModal user={me} onClose={() => setShowProfile(false)} onSave={(user) => { setMe(user); setShowProfile(false); }} />}

      {incoming && !activeCall && <div className="call-overlay"><div className="incoming-card"><span className="avatar avatar-2 xlarge">{initials(incoming.callerName)}</span><p>Incoming {incoming.mode} call</p><h2>{incoming.callerName}</h2><div><button className="decline" onClick={() => closeCall()}>×</button><button className="answer" onClick={answerCall}>☎</button></div></div></div>}

      {activeCall && <div className={`call-screen ${activeCall.mode}`}>
        <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
        <div className="call-fallback"><span className="avatar avatar-2 xlarge">{initials(activeCall.peerName)}</span><h2>{activeCall.peerName}</h2><p>{activeCall.status === "ringing" ? "Calling…" : "Connected"}</p></div>
        <video ref={localVideoRef} autoPlay muted playsInline className="local-video" />
        <div className="call-controls"><button className={muted ? "off" : ""} onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>{activeCall.mode === "video" && <button className={cameraOff ? "off" : ""} onClick={toggleCamera}>{cameraOff ? "Camera on" : "Camera off"}</button>}<button className="hangup" onClick={() => closeCall()}>End call</button></div>
      </div>}
    </main>
  );
}

function ProfileModal({ user, onClose, onSave }: { user: User; onClose: () => void; onSave: (user: User) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [handle, setHandle] = useState(user.handle);
  const [bio, setBio] = useState(user.bio);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const data = await API<{ user: User }>("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName, handle, bio }) });
      onSave(data.user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save profile"); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal profile-modal" onSubmit={save} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose}>×</button><span className="avatar avatar-me xlarge">{initials(displayName)}</span><p className="eyebrow">Your Relay profile</p><h2>Make it feel like you.</h2><label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={50} /></label><label>Handle<div className="handle-input"><span>@</span><input value={handle} onChange={(event) => setHandle(event.target.value)} maxLength={24} /></div></label><label>Bio<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={140} placeholder="A little about you" /></label>{error && <p className="form-error">{error}</p>}<button className="save-profile">Save profile</button><a className="signout" href="/signout-with-chatgpt?return_to=/">Sign out</a></form></div>;
}
