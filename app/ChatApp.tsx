"use client";

import type { User as AuthUser } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import DownloadSection from "@/app/DownloadSection";
import { enableDesktopNotifications, isDesktopApp, sendDesktopNotification } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";

type User = { id: string; displayName: string; handle: string; bio: string; lastSeen: string };
type Conversation = {
  id: string; peerId: string; peerName: string; peerHandle: string; peerLastSeen: string;
  lastBody: string | null; lastKind: "text" | "image" | "audio" | null; lastMessageAt: string | null;
};
type Message = {
  id: string; senderId: string; senderName: string; kind: "text" | "image" | "audio";
  body: string | null; objectName: string | null; objectType: string | null; storagePath: string | null;
  mediaUrl: string | null; createdAt: string;
};
type Call = {
  id: string; conversationId: string; callerId: string; calleeId: string; callerName: string;
  mode: "voice" | "video"; status: "ringing" | "active" | "ended";
  offerSdp: RTCSessionDescriptionInit | null; answerSdp: RTCSessionDescriptionInit | null;
};
type PermissionStatus = "unchecked" | "granted" | "blocked";
type DesktopPermissions = { notifications: PermissionStatus; microphone: PermissionStatus; camera: PermissionStatus };

const asError = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
const handleHelp = "Use 3–24 lowercase letters, numbers, or underscores. Example: smart_window";
const normalizeHandle = (value: string) => value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
const permissionSetupKey = "relay:desktop-permissions:v1";
const initialDesktopPermissions: DesktopPermissions = { notifications: "unchecked", microphone: "unchecked", camera: "unchecked" };
const appUrl = () => {
  const desktopWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (desktopWindow.__TAURI_INTERNALS__) return "https://smart-window.github.io/relay-chat/";
  return `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`;
};
const initials = (name: string) => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
const relativeTime = (value?: string | null) => {
  if (!value) return "";
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 120_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
};
const toUser = (row: Record<string, unknown>): User => ({
  id: String(row.id),
  displayName: String(row.display_name),
  handle: String(row.handle),
  bio: String(row.bio || ""),
  lastSeen: String(row.last_seen),
});

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

async function requestMediaPermission(kind: "microphone" | "camera") {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === "microphone" ? { audio: true } : { video: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

export default function ChatApp() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [me, setMe] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [desktopPermissions, setDesktopPermissions] = useState<DesktopPermissions>(initialDesktopPermissions);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
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
  const selectedIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const notifiedCallRef = useRef<string | null>(null);
  const automaticPermissionRequestRef = useRef(false);

  const selected = conversations.find((conversation) => conversation.id === selectedId) || null;

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  const requestDesktopPermissions = useCallback(async () => {
    setPermissionBusy(true);
    setPermissionError("");
    const notifications = await enableDesktopNotifications({ retry: true });
    const microphone = await requestMediaPermission("microphone");
    const camera = await requestMediaPermission("camera");
    const next: DesktopPermissions = {
      notifications: notifications ? "granted" : "blocked",
      microphone: microphone ? "granted" : "blocked",
      camera: camera ? "granted" : "blocked",
    };
    setDesktopPermissions(next);
    if (notifications && microphone && camera) {
      window.localStorage.setItem(permissionSetupKey, "granted");
    } else {
      window.localStorage.removeItem(permissionSetupKey);
      setPermissionError("Some permissions are still blocked. Allow Relay in your system settings, then try again.");
    }
    setPermissionBusy(false);
  }, []);

  const updateRelay = useCallback(async () => {
    if (!isDesktopApp()) return;
    setUpdateBusy(true);
    setUpdateMessage("Checking for updates…");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setUpdateMessage("Relay is already up to date.");
        setUpdateBusy(false);
        return;
      }

      let downloaded = 0;
      let total = 0;
      setUpdateMessage(`Downloading Relay ${update.version}…`);
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength || 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdateMessage(total > 0 ? `Downloading Relay ${update.version}… ${Math.min(100, Math.round(downloaded / total * 100))}%` : `Downloading Relay ${update.version}…`);
        }
        if (event.event === "Finished") setUpdateMessage("Installing update and restarting…");
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (cause) {
      setUpdateMessage(asError(cause, "Relay could not install the update. Please try again."));
      setUpdateBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!showPermissions || automaticPermissionRequestRef.current) return;
    automaticPermissionRequestRef.current = true;
    const requestTimer = setTimeout(() => { requestDesktopPermissions().catch(() => undefined); }, 300);
    return () => clearTimeout(requestTimer);
  }, [requestDesktopPermissions, showPermissions]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) { setAuthUser(data.session?.user || null); setAuthReady(true); }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user || null);
      setAuthReady(true);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  const refreshConversations = useCallback(async (userId = authUser?.id) => {
    if (!userId) return;
    const { data: mine, error: mineError } = await supabase.from("conversation_members").select("conversation_id").eq("user_id", userId);
    if (mineError) throw mineError;
    const ids = [...new Set((mine || []).map((row) => row.conversation_id as string))];
    if (!ids.length) { setConversations([]); setSelectedId(null); return; }

    const [{ data: members, error: memberError }, { data: recent, error: messageError }] = await Promise.all([
      supabase.from("conversation_members").select("conversation_id,user_id").in("conversation_id", ids).neq("user_id", userId),
      supabase.from("messages").select("conversation_id,kind,body,created_at").in("conversation_id", ids).order("created_at", { ascending: false }),
    ]);
    if (memberError) throw memberError;
    if (messageError) throw messageError;
    const peerIds = [...new Set((members || []).map((row) => row.user_id as string))];
    const { data: peers, error: peerError } = peerIds.length
      ? await supabase.from("profiles").select("id,display_name,handle,bio,last_seen").in("id", peerIds)
      : { data: [], error: null };
    if (peerError) throw peerError;

    const peerById = new Map((peers || []).map((row) => [row.id as string, row]));
    const peerByConversation = new Map((members || []).map((row) => [row.conversation_id as string, row.user_id as string]));
    const lastByConversation = new Map<string, Record<string, unknown>>();
    for (const row of recent || []) if (!lastByConversation.has(row.conversation_id as string)) lastByConversation.set(row.conversation_id as string, row);
    const next = ids.flatMap((id) => {
      const peerId = peerByConversation.get(id);
      const peer = peerId ? peerById.get(peerId) : null;
      if (!peerId || !peer) return [];
      const last = lastByConversation.get(id);
      return [{
        id, peerId, peerName: String(peer.display_name), peerHandle: String(peer.handle), peerLastSeen: String(peer.last_seen),
        lastBody: last ? String(last.body || "") : null,
        lastKind: last ? last.kind as Conversation["lastKind"] : null,
        lastMessageAt: last ? String(last.created_at) : null,
      }];
    }).sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime());
    setConversations(next);
    setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id || null);
  }, [authUser?.id]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data, error: messageError } = await supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true });
    if (messageError) throw messageError;
    const senderIds = [...new Set((data || []).map((row) => row.sender_id as string))];
    const { data: senders, error: senderError } = senderIds.length
      ? await supabase.from("profiles").select("id,display_name").in("id", senderIds)
      : { data: [], error: null };
    if (senderError) throw senderError;
    const senderNames = new Map((senders || []).map((row) => [row.id as string, String(row.display_name)]));
    const next = await Promise.all((data || []).map(async (row): Promise<Message> => {
      let mediaUrl: string | null = null;
      if (row.storage_path) {
        const { data: signed } = await supabase.storage.from("media").createSignedUrl(row.storage_path as string, 3600);
        mediaUrl = signed?.signedUrl || null;
      }
      return {
        id: row.id as string, senderId: row.sender_id as string,
        senderName: senderNames.get(row.sender_id as string) || "Relay member",
        kind: row.kind as Message["kind"], body: row.body as string | null,
        objectName: row.object_name as string | null, objectType: row.object_type as string | null,
        storagePath: row.storage_path as string | null, mediaUrl, createdAt: row.created_at as string,
      };
    }));
    setMessages(next);
  }, []);

  useEffect(() => {
    if (!authUser) return;
    let live = true;
    (async () => {
      const { data, error: profileError } = await supabase.from("profiles").select("*").eq("id", authUser.id).single();
      if (profileError) throw profileError;
      if (!live) return;
      setMe(toUser(data));
      if (isDesktopApp() && window.localStorage.getItem(permissionSetupKey) !== "granted") setShowPermissions(true);
      await refreshConversations(authUser.id);
      if (live) setAppReady(true);
    })().catch((cause) => { if (live) { setError(asError(cause, "Could not open Relay")); setAppReady(true); } });
    const touch = () => supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", authUser.id).then(() => undefined);
    touch();
    const timer = setInterval(touch, 60_000);
    return () => { live = false; clearInterval(timer); };
  }, [authUser, refreshConversations]);

  useEffect(() => {
    if (!selectedId) return;
    const initialLoad = setTimeout(() => loadMessages(selectedId).catch((cause) => setError(asError(cause, "Could not load messages"))), 0);
    return () => clearTimeout(initialLoad);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    if (!authUser) return;

    const notifyIncomingMessage = async (row: Record<string, unknown>) => {
      const conversationId = String(row.conversation_id);
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      let senderName = conversation?.peerName || "Relay member";
      if (!conversation) {
        const { data } = await supabase.from("profiles").select("display_name").eq("id", String(row.sender_id)).maybeSingle();
        senderName = data?.display_name || senderName;
      }
      const kind = String(row.kind);
      const body = kind === "image" ? "Sent you a photo" : kind === "audio" ? "Sent you a voice message" : String(row.body || "New message");
      await sendDesktopNotification(senderName, body);
    };

    const channel = supabase.channel(`messages:user:${authUser.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        const conversationId = String(row.conversation_id);
        refreshConversations(authUser.id).catch(() => undefined);
        if (selectedIdRef.current === conversationId) loadMessages(conversationId).catch(() => undefined);

        const isIncoming = String(row.sender_id) !== authUser.id;
        const currentConversationIsVisible = selectedIdRef.current === conversationId && document.visibilityState === "visible" && document.hasFocus();
        if (isIncoming && !currentConversationIsVisible) notifyIncomingMessage(row).catch(() => undefined);
      }).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [authUser, loadMessages, refreshConversations]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (!authUser || search.trim().length < 2) return;
    const timer = setTimeout(async () => {
      const query = search.toLowerCase().replace(/[^a-z0-9_ -]/g, "").trim();
      if (!query) return;
      const { data } = await supabase.from("profiles").select("*").neq("id", authUser.id)
        .or(`display_name.ilike.%${query}%,handle.ilike.%${query}%`).limit(12);
      setResults((data || []).map(toUser));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, authUser]);

  const closeCall = useCallback(async (notify = true) => {
    const callId = activeCall?.id || incoming?.id;
    if (notify && callId) await supabase.from("calls").update({ status: "ended", updated_at: new Date().toISOString() }).eq("id", callId);
    peerRef.current?.close(); peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop()); localStreamRef.current = null;
    setActiveCall(null); setIncoming(null); setMuted(false); setCameraOff(false);
  }, [activeCall?.id, incoming?.id]);

  useEffect(() => {
    if (!authUser || activeCall) return;
    const poll = async () => {
      const { data } = await supabase.from("calls").select("*").eq("callee_id", authUser.id).eq("status", "ringing").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!data) { setIncoming(null); notifiedCallRef.current = null; return; }
      const { data: caller } = await supabase.from("profiles").select("display_name").eq("id", data.caller_id).single();
      const nextCall: Call = {
        id: data.id, conversationId: data.conversation_id, callerId: data.caller_id, calleeId: data.callee_id,
        callerName: caller?.display_name || "Relay member", mode: data.mode, status: data.status,
        offerSdp: data.offer_sdp, answerSdp: data.answer_sdp,
      };
      setIncoming(nextCall);
      if (notifiedCallRef.current !== nextCall.id) {
        notifiedCallRef.current = nextCall.id;
        if (document.visibilityState !== "visible" || !document.hasFocus()) {
          sendDesktopNotification(`Incoming ${nextCall.mode} call`, `${nextCall.callerName} is calling`).catch(() => undefined);
        }
      }
    };
    poll();
    const timer = setInterval(poll, 2200);
    return () => clearInterval(timer);
  }, [authUser, activeCall]);

  useEffect(() => {
    if (!activeCall) return;
    const timer = setInterval(async () => {
      const { data } = await supabase.from("calls").select("status,answer_sdp").eq("id", activeCall.id).maybeSingle();
      if (!data || data.status === "ended") return closeCall(false);
      if (data.answer_sdp && peerRef.current && !peerRef.current.remoteDescription) {
        await peerRef.current.setRemoteDescription(data.answer_sdp as RTCSessionDescriptionInit);
        setActiveCall((current) => current ? { ...current, status: "active", answerSdp: data.answer_sdp } : current);
      }
    }, 1300);
    return () => clearInterval(timer);
  }, [activeCall, closeCall]);

  const openConversation = (id: string) => { setSelectedId(id); setMobileSidebar(false); };
  const startConversation = async (userId: string) => {
    setError("");
    const { data, error: rpcError } = await supabase.rpc("create_direct_conversation", { peer_id: userId });
    if (rpcError) { setError(rpcError.message); return; }
    await refreshConversations();
    openConversation(data as string);
    setShowSearch(false); setSearch(""); setResults([]);
  };

  const send = async () => {
    if (!selectedId || !me || !draft.trim()) return;
    setSending(true); setError("");
    const body = draft.trim();
    const { error: sendError } = await supabase.from("messages").insert({ conversation_id: selectedId, sender_id: me.id, kind: "text", body });
    if (sendError) setError(sendError.message);
    else { setDraft(""); await Promise.all([loadMessages(selectedId), refreshConversations()]); }
    setSending(false);
  };

  const uploadFile = async (file: File) => {
    if (!selectedId || !me) return;
    if (file.size > 12 * 1024 * 1024) { setError("Files must be 12 MB or smaller."); return; }
    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : null;
    if (!kind) { setError("Choose an image or audio file."); return; }
    setSending(true); setError("");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || `${kind}.bin`;
    const path = `${me.id}/${crypto.randomUUID()}-${safeName}`;
    try {
      const { error: uploadError } = await supabase.storage.from("media").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: messageError } = await supabase.from("messages").insert({
        conversation_id: selectedId, sender_id: me.id, kind, storage_path: path, object_name: file.name, object_type: file.type,
      });
      if (messageError) { await supabase.storage.from("media").remove([path]); throw messageError; }
      await Promise.all([loadMessages(selectedId), refreshConversations()]);
    } catch (cause) { setError(asError(cause, "Upload failed")); }
    setSending(false);
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
      const offer = peer.localDescription?.toJSON() || null;
      const { data, error: callError } = await supabase.from("calls").insert({
        conversation_id: selected.id, caller_id: me.id, callee_id: selected.peerId, mode, offer_sdp: offer,
      }).select("id").single();
      if (callError) throw callError;
      setActiveCall({ id: data.id, conversationId: selected.id, callerId: me.id, calleeId: selected.peerId, callerName: me.displayName, peerName: selected.peerName, mode, status: "ringing", offerSdp: offer, answerSdp: null });
    } catch (cause) { closeCall(false); setError(asError(cause, "Camera or microphone access is needed to start a call.")); }
  };

  const answerCall = async () => {
    if (!incoming?.offerSdp) return;
    try {
      const peer = await preparePeer(incoming.mode);
      await peer.setRemoteDescription(incoming.offerSdp);
      await peer.setLocalDescription(await peer.createAnswer());
      await waitForIce(peer);
      const answer = peer.localDescription?.toJSON() || null;
      const { error: answerError } = await supabase.from("calls").update({ status: "active", answer_sdp: answer, updated_at: new Date().toISOString() }).eq("id", incoming.id);
      if (answerError) throw answerError;
      setActiveCall({ ...incoming, peerName: incoming.callerName, status: "active", answerSdp: answer }); setIncoming(null);
    } catch (cause) { setError(asError(cause, "Could not connect the call.")); }
  };

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMuted(!track.enabled); }
  };
  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setCameraOff(!track.enabled); }
  };

  if (!authReady) return <div className="app-loading"><span className="brand-mark">R</span><p>Opening Relay…</p></div>;
  if (!authUser) return <AuthLanding />;
  if (!appReady || !me || me.id !== authUser.id) return <div className="app-loading"><span className="brand-mark">R</span><p>{error || "Loading your conversations…"}</p></div>;

  return (
    <main className="chat-shell">
      <aside className={`sidebar ${mobileSidebar ? "mobile-open" : ""}`}>
        <header className="sidebar-header">
          <a className="brand" href="#" aria-label="Relay home"><span className="brand-mark">R</span><span>relay</span></a>
          <div className="sidebar-header-actions"><a className="round-btn" href="./download/" aria-label="Download Relay desktop apps">↓</a><button className="round-btn" onClick={() => setShowSearch(true)} aria-label="Start a new conversation">＋</button></div>
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {message.kind === "image" && message.mediaUrl && <div className="image-message"><img src={message.mediaUrl} alt={message.objectName || "Shared image"} /><time>{relativeTime(message.createdAt)}</time></div>}
                {message.kind === "audio" && message.mediaUrl && <div className="audio-message"><span>♪</span><audio controls preload="metadata" src={message.mediaUrl} /><time>{relativeTime(message.createdAt)}</time></div>}
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

      {showSearch && <div className="modal-backdrop" onMouseDown={() => setShowSearch(false)}><section className="modal search-modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-label="New conversation"><button className="modal-close" onClick={() => setShowSearch(false)}>×</button><p className="eyebrow">New conversation</p><h2>Who’s on your mind?</h2><label className="search-field"><span>⌕</span><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or @handle" /></label><div className="search-results">{search.length < 2 && <p>Type at least two characters to find someone on Relay.</p>}{search.length >= 2 && results.length === 0 && <p>No matches yet. They may need to create a Relay account first.</p>}{search.length >= 2 && results.map((user) => <button key={user.id} onClick={() => startConversation(user.id)}><span className="avatar avatar-2">{initials(user.displayName)}</span><span><strong>{user.displayName}</strong><small>@{user.handle}</small></span><b>Message →</b></button>)}</div></section></div>}

      {showProfile && <ProfileModal user={me} updateBusy={updateBusy} updateMessage={updateMessage} onUpdate={updateRelay} onClose={() => setShowProfile(false)} onPermissions={() => { setShowProfile(false); setShowPermissions(true); }} onSave={(user) => { setMe(user); setShowProfile(false); }} />}

      {showPermissions && <PermissionsModal permissions={desktopPermissions} busy={permissionBusy} error={permissionError} onEnable={requestDesktopPermissions} onClose={() => setShowPermissions(false)} />}

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

function AuthLanding() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const show = (nextMode: "signup" | "signin") => { setMode(nextMode); setOpen(true); setError(""); setNotice(""); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "signup") {
        if (displayName.trim().length < 2) throw new Error("Enter a display name with at least 2 characters.");
        const { data, error: authError } = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: displayName.trim() }, emailRedirectTo: appUrl() },
        });
        if (authError) throw authError;
        if (!data.session) setNotice("Account created. Check your email to confirm it, then sign in.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
      }
    } catch (cause) { setError(asError(cause, "Authentication failed")); }
    setBusy(false);
  };
  return <main className="landing">
    <nav className="landing-nav" aria-label="Main navigation"><a className="brand brand-dark" href="#top" aria-label="Relay home"><span className="brand-mark">R</span><span>relay</span></a><div className="nav-actions"><a href="./download/">Download apps</a><button className="nav-signin" onClick={() => show("signin")}>Sign in</button></div></nav>
    <section className="hero" id="top"><div className="hero-copy"><p className="eyebrow">Your people, one tap away</p><h1>Talk like you’re<br />in the same room.</h1><p className="hero-lede">Messages, moments, and face-to-face calls in one beautifully simple place. Relay is free to join and built for the conversations that matter.</p><div className="hero-actions"><button className="primary-cta" onClick={() => show("signup")}>Create your free account <span>→</span></button><a className="download-cta" href="./download/">Get the desktop app ↓</a></div><span className="microcopy">No card. No clutter. Free to download.</span></div>
      <div className="hero-visual" aria-label="Relay conversation preview"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="phone-card"><div className="phone-top"><span className="avatar coral">M</span><div><strong>Maya</strong><small>online now</small></div><button aria-label="Start video call">◉</button></div><div className="sample-chat"><div className="sample-day">TODAY</div><div className="bubble received">The light is perfect here ✨<small>10:41</small></div><div className="sample-image"><div className="sun" /><div className="ridge ridge-a"/><div className="ridge ridge-b"/></div><div className="bubble sent">Save me a seat?<small>10:43 · read</small></div><div className="voice-note"><button aria-label="Play voice message">▶</button><div className="wave">▂▄▅▃▇▅▂▄▆▃▅▇▂▄</div><span>0:18</span></div></div><div className="sample-composer"><span>Write a message…</span><b>↑</b></div></div><div className="float-pill pill-call"><span>●</span> Crystal-clear calls</div><div className="float-pill pill-private">✦ Private by design</div></div>
    </section>
    <section className="feature-strip" aria-label="Relay features"><article><span>01</span><h2>Say it your way</h2><p>Text, photos, and voice notes—share what words alone can’t.</p></article><article><span>02</span><h2>Feel closer</h2><p>Jump into crisp voice or video calls without links or scheduling.</p></article><article><span>03</span><h2>Keep it yours</h2><p>Your media stays private and every conversation is account-protected.</p></article></section>
    <DownloadSection />
    {open && <div className="modal-backdrop" onMouseDown={() => setOpen(false)}><form className="modal auth-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setOpen(false)}>×</button><p className="eyebrow">{mode === "signup" ? "Join Relay" : "Welcome back"}</p><h2>{mode === "signup" ? "Create your account." : "Good to see you."}</h2>{mode === "signup" && <label>Display name<input autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={50} required /></label>}<label>Email<input autoFocus={mode === "signin"} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required /></label>{error && <p className="form-error">{error}</p>}{notice && <p className="form-notice">{notice}</p>}<button className="save-profile" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create free account" : "Sign in"}</button><button type="button" className="auth-switch" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setNotice(""); }}>{mode === "signup" ? "Already have an account? Sign in" : "New to Relay? Create an account"}</button></form></div>}
  </main>;
}

function PermissionsModal({ permissions, busy, error, onEnable, onClose }: { permissions: DesktopPermissions; busy: boolean; error: string; onEnable: () => void; onClose: () => void }) {
  const rows: Array<{ key: keyof DesktopPermissions; title: string; detail: string }> = [
    { key: "notifications", title: "Notifications", detail: "See new messages and incoming calls." },
    { key: "microphone", title: "Microphone", detail: "Record voice notes and join calls." },
    { key: "camera", title: "Camera", detail: "Share video during video calls." },
  ];
  const allGranted = Object.values(permissions).every((status) => status === "granted");
  const label = (status: PermissionStatus) => status === "granted" ? "Enabled" : status === "blocked" ? "Blocked" : "Not checked";
  return <div className="modal-backdrop"><section className="modal permissions-modal" aria-modal="true" role="dialog" aria-labelledby="permissions-title"><button type="button" className="modal-close" onClick={onClose} aria-label="Close permission setup">×</button><p className="eyebrow">Automatic desktop setup</p><h2 id="permissions-title">Relay is requesting access.</h2><p className="permissions-intro">Relay starts each request automatically. Choose Allow in the system dialogs so messages, voice notes, and calls work correctly.</p><div className="permission-list">{rows.map((row) => <article className="permission-row" key={row.key}><span className={`permission-icon ${permissions[row.key]}`}>{permissions[row.key] === "granted" ? "✓" : permissions[row.key] === "blocked" ? "!" : "•"}</span><span><strong>{row.title}</strong><small>{row.detail}</small></span><b className={permissions[row.key]}>{busy && permissions[row.key] === "unchecked" ? "Requesting…" : label(permissions[row.key])}</b></article>)}</div>{error && <><p className="form-error permission-error" role="alert">{error}</p><p className="settings-help">macOS: System Settings → Privacy &amp; Security. Windows: Settings → Privacy &amp; security.</p></>}<button type="button" className="save-profile" onClick={allGranted ? onClose : onEnable} disabled={busy}>{busy ? "Waiting for system approval…" : allGranted ? "Done" : permissions.notifications === "unchecked" ? "Request permissions now" : "Try again"}</button><button type="button" className="auth-switch" onClick={onClose}>Later</button></section></div>;
}

function ProfileModal({ user, updateBusy, updateMessage, onUpdate, onClose, onSave, onPermissions }: { user: User; updateBusy: boolean; updateMessage: string; onUpdate: () => void; onClose: () => void; onSave: (user: User) => void; onPermissions: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [handle, setHandle] = useState(user.handle);
  const [bio, setBio] = useState(user.bio);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    const normalizedName = displayName.trim();
    const normalizedHandle = normalizeHandle(handle);
    if (normalizedName.length < 2) { setError("Display name must be at least 2 characters."); return; }
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedHandle)) { setError(handleHelp); return; }
    const { data, error: saveError } = await supabase.from("profiles").update({ display_name: displayName.trim(), handle: normalizedHandle, bio: bio.trim() }).eq("id", user.id).select("*").single();
    if (saveError) setError(saveError.code === "23505" ? "That handle is already taken. Try another one." : saveError.message); else onSave(toUser(data));
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal profile-modal" onSubmit={save} onMouseDown={(event) => event.stopPropagation()} noValidate><button type="button" className="modal-close" onClick={onClose}>×</button><span className="avatar avatar-me xlarge">{initials(displayName)}</span><p className="eyebrow">Your Relay profile</p><h2>Make it feel like you.</h2><label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={50} /></label><label>Handle<div className="handle-input"><span>@</span><input value={handle} onChange={(event) => setHandle(normalizeHandle(event.target.value))} maxLength={24} placeholder="smart_window" autoCapitalize="none" autoComplete="username" spellCheck={false} aria-describedby="handle-help" /></div><small className="field-help" id="handle-help">3–24 lowercase letters, numbers, or underscores. Example: smart_window</small></label><label>Bio<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={140} placeholder="A little about you" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="save-profile">Save profile</button><button type="button" className="auth-switch" onClick={onPermissions}>Camera, microphone &amp; notifications</button>{isDesktopApp() && <><button type="button" className="auth-switch update-relay" onClick={onUpdate} disabled={updateBusy}>{updateBusy ? "Updating Relay…" : "Update Relay"}</button>{updateMessage && <p className="update-status" role="status">{updateMessage}</p>}</>}<button type="button" className="auth-switch" onClick={() => supabase.auth.signOut()}>Sign out</button></form></div>;
}
