import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Activity, AudioLines, Bell, Check, ChevronDown, CircleHelp, Compass, Copy, Crown, Hash,
  Headphones, LogOut, Mic, MicOff, MonitorUp, Plus, Search, Send, Settings, ShieldCheck,
  Sparkles, Speaker, Users, Volume2, VolumeX, Wifi, X, MessageSquare, Gamepad2, Menu,
  ArrowUpRight, ExternalLink, Radio, Server, MessagesSquare, CircleDot, UserRoundPlus,
} from 'lucide-react';
import { ControlBar, LiveKitRoom, RoomAudioRenderer, useParticipants, useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';

type Channel = { id: string; name: string; type: 'text' | 'voice'; category: string };
type Community = { id: string; name: string; description: string; category: string; public: boolean; channels: Channel[] };
type ChatMessage = { id: string; channelId: string; author: string; text: string; createdAt: string };
type VoiceCreds = { token: string; serverUrl: string; roomName: string };
type PresenceUser = { id: string; name: string };

const API = (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, '') || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.hostname) ? 'http://localhost:3001' : window.location.origin);

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);
  return data as T;
}

function Avatar({ name, size = 'md', color }: { name: string; size?: 'sm' | 'md' | 'lg'; color?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(v => v[0] || '').join('').toUpperCase() || '?';
  const colors = ['#6c5ce7', '#227c9d', '#ce6a85', '#b86f52', '#3b8d72', '#9a6aff'];
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return <div className={`avatar avatar-${size}`} style={{ background: color || colors[hash % colors.length] }}>{initials}</div>;
}

function VoiceStage({ onLeave }: { onLeave: () => void }) {
  const participants = useParticipants();
  const screenTracks = useTracks([Track.Source.ScreenShare]);
  return <div className="voice-content">
    <div className="voice-stage-heading"><div><span className="eyebrow"><span className="live-dot"/> AO VIVO</span><h2>Conectado à sala de voz</h2><p>Seu áudio e compartilhamento passam por uma sala WebRTC.</p></div><div className="stage-count"><Users size={15}/>{participants.length} {participants.length === 1 ? 'pessoa' : 'pessoas'}</div></div>
    {screenTracks.length > 0 ? <div className="screen-grid">{screenTracks.map((track) => <div className="screen-tile" key={`${track.participant.sid}-${track.publication?.trackSid || 'screen'}`}><div className="screen-label"><MonitorUp size={14}/>{track.participant.name || track.participant.identity} está compartilhando</div><VideoTrack trackRef={track} /></div>)}</div> : <div className="voice-empty-stage"><div className="wave-orb"><AudioLines size={32}/></div><h3>Sala conectada</h3><p>Quando alguém compartilhar a tela, ela aparecerá aqui.</p><div className="participant-pills">{participants.map(p => <span className="participant-pill" key={p.sid}><span className="participant-dot"/>{p.name || p.identity}</span>)}</div></div>}
    <div className="voice-bottom-bar"><div className="voice-participants-mini">{participants.slice(0, 5).map(p => <div className="mini-person" key={p.sid} title={p.name || p.identity}><Avatar name={p.name || p.identity} size="sm"/></div>)}<span>{participants.length} na sala</span></div><div className="lk-control-wrap"><ControlBar controls={{ microphone: true, camera: false, screenShare: true, chat: false, leave: false }} variation="minimal" /></div><button className="btn danger" onClick={onLeave}><LogOut size={16}/> Sair da voz</button></div>
    <RoomAudioRenderer />
  </div>;
}

export default function App() {
  const [username, setUsername] = useState(() => localStorage.getItem('nexoUsername') || '');
  const [usernameDraft, setUsernameDraft] = useState(() => localStorage.getItem('nexoUsername') || '');
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityId, setCommunityId] = useState('nexo-lounge');
  const [channelId, setChannelId] = useState('nexo-general');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [socketReady, setSocketReady] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [modal, setModal] = useState<'create' | 'discover' | 'profile' | null>(null);
  const [communityName, setCommunityName] = useState('');
  const [communityDescription, setCommunityDescription] = useState('');
  const [communitySearch, setCommunitySearch] = useState('');
  const [liveKitConfigured, setLiveKitConfigured] = useState(false);
  const [liveKitUrl, setLiveKitUrl] = useState<string | null>(null);
  const [voiceCreds, setVoiceCreds] = useState<VoiceCreds | null>(null);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [communityError, setCommunityError] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const activeCommunity = useMemo(() => communities.find(c => c.id === communityId) || communities[0], [communities, communityId]);
  const activeChannel = useMemo(() => activeCommunity?.channels.find(c => c.id === channelId) || activeCommunity?.channels[0], [activeCommunity, channelId]);
  const textChannels = activeCommunity?.channels.filter(c => c.type === 'text') || [];
  const voiceChannels = activeCommunity?.channels.filter(c => c.type === 'voice') || [];

  const loadCommunities = useCallback(async () => {
    try {
      const result = await request<Community[]>('/api/communities');
      setCommunities(result);
      setCommunityId(current => result.some(c => c.id === current) ? current : (result[0]?.id || ''));
      setChannelId(current => result.some(c => c.channels.some(ch => ch.id === current)) ? current : (result[0]?.channels.find(ch => ch.type === 'text')?.id || result[0]?.channels[0]?.id || ''));
    } catch (error) {
      setCommunityError(`Não foi possível conectar à API (${error instanceof Error ? error.message : 'erro'}). Inicie o servidor do projeto.`);
    }
  }, []);

  useEffect(() => {
    void loadCommunities();
    request<{ livekitConfigured: boolean; livekitUrl: string | null }>('/api/config').then(config => {
      setLiveKitConfigured(config.livekitConfigured); setLiveKitUrl(config.livekitUrl);
    }).catch(() => { setLiveKitConfigured(false); });
    const socket = io(API, { transports: ['websocket', 'polling'], reconnectionAttempts: 6 });
    socketRef.current = socket;
    socket.on('connect', () => { setSocketReady(true); const savedName = localStorage.getItem('nexoUsername') || ''; if (savedName) socket.emit('presence:join', savedName); });
    socket.on('disconnect', () => setSocketReady(false));
    socket.on('presence:list', (users: PresenceUser[]) => setPresence(users));
    socket.on('channel:message', (message: ChatMessage) => setMessages(current => current.some(m => m.id === message.id) ? current : [...current, message]));
    socket.on('communities:updated', (result: Community[]) => setCommunities(result));
    return () => { socket.disconnect(); socketRef.current = null; };
    // Socket lifecycle is tied to API URL; username is emitted separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCommunities]);

  useEffect(() => {
    if (username && socketRef.current?.connected) socketRef.current.emit('presence:join', username);
  }, [username]);

  useEffect(() => {
    if (!activeChannel || activeChannel.type !== 'text' || !socketRef.current) { setMessages([]); return; }
    const socket = socketRef.current;
    setMessages([]);
    socket.emit('channel:join', { channelId: activeChannel.id }, (result: { ok: boolean; messages?: ChatMessage[]; error?: string }) => {
      if (result?.ok) setMessages(result.messages || []);
    });
  }, [activeChannel?.id, socketReady]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);

  useEffect(() => {
    setVoiceCreds(null); setVoiceError('');
  }, [channelId]);

  const saveUsername = (event?: FormEvent) => {
    event?.preventDefault();
    const name = usernameDraft.trim().slice(0, 32);
    if (name.length < 2) return;
    localStorage.setItem('nexoUsername', name);
    setUsername(name);
    setModal(null);
  };

  const chooseCommunity = (community: Community) => {
    setCommunityId(community.id);
    const defaultChannel = community.channels.find(c => c.type === 'text') || community.channels[0];
    if (defaultChannel) setChannelId(defaultChannel.id);
    setMobileNavOpen(false);
  };

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const text = messageDraft.trim();
    if (!text || !activeChannel || activeChannel.type !== 'text' || !username) return;
    const socket = socketRef.current;
    if (!socket?.connected) { setCommunityError('Conexão com o servidor perdida. Tente novamente.'); return; }
    socket.emit('channel:message', { channelId: activeChannel.id, author: username, text }, (result: { ok: boolean; error?: string }) => {
      if (!result?.ok) setCommunityError(result?.error || 'Não foi possível enviar a mensagem.');
    });
    setMessageDraft(''); setCommunityError('');
  };

  const joinVoice = async () => {
    if (!activeChannel || activeChannel.type !== 'voice' || !username) return;
    setVoiceConnecting(true); setVoiceError('');
    try {
      const result = await request<VoiceCreds>('/api/livekit/token', { method: 'POST', body: JSON.stringify({ username, channelId: activeChannel.id }) });
      setVoiceCreds(result);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Falha ao entrar na voz.');
    } finally { setVoiceConnecting(false); }
  };

  const createCommunity = async (event: FormEvent) => {
    event.preventDefault(); setCommunityError('');
    try {
      const created = await request<Community>('/api/communities', { method: 'POST', body: JSON.stringify({ name: communityName, description: communityDescription }) });
      setCommunities(current => current.some(c => c.id === created.id) ? current : [...current, created]);
      chooseCommunity(created); setCommunityName(''); setCommunityDescription(''); setModal(null);
    } catch (error) { setCommunityError(error instanceof Error ? error.message : 'Falha ao criar comunidade.'); }
  };

  const visibleCommunities = communities.filter(c => `${c.name} ${c.description}`.toLowerCase().includes(communitySearch.toLowerCase()));
  const onlineCount = presence.length || 1;

  const onChannelKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); }
  };

  return <div className="app-shell">
    <aside className={`server-rail ${mobileNavOpen ? 'rail-open' : ''}`}>
      <button className="brand-mark" title="Nexo Voice" onClick={() => { setCommunityId('nexo-lounge'); setChannelId('nexo-general'); }}><span className="brand-glyph">N</span></button>
      <div className="rail-divider" />
      {communities.map(community => <button key={community.id} className={`server-icon ${community.id === communityId ? 'selected' : ''}`} title={community.name} onClick={() => chooseCommunity(community)}><span>{community.name.trim().slice(0, 2).toUpperCase()}</span>{community.id === communityId && <i />}</button>)}
      <button className="rail-action" title="Criar comunidade" onClick={() => setModal('create')}><Plus size={21}/></button>
      <button className="rail-action explore" title="Explorar comunidades públicas" onClick={() => setModal('discover')}><Compass size={20}/></button>
      <div className="rail-spacer" />
      <button className="rail-action" title="Ajuda" onClick={() => setCommunityError('MVP Nexo Voice: texto em tempo real e salas de voz/tela via LiveKit.') }><CircleHelp size={19}/></button>
    </aside>

    <aside className={`channel-sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
      <button className="community-header" onClick={() => setModal('discover')}><div className="community-header-main"><div className="community-emblem">{activeCommunity?.name.slice(0, 1).toUpperCase() || 'N'}</div><div className="community-header-text"><strong>{activeCommunity?.name || 'Nexo Voice'}</strong><span>Comunidade pública</span></div></div><ChevronDown size={16}/></button>
      <div className="sidebar-scroll">
        <div className="side-section-title"><span>CANAIS DE TEXTO</span><button title="Criar comunidade" onClick={() => setModal('create')}><Plus size={15}/></button></div>
        {textChannels.map(ch => <button key={ch.id} className={`channel-row ${ch.id === activeChannel?.id ? 'active' : ''}`} onClick={() => { setChannelId(ch.id); setMobileNavOpen(false); }}><Hash size={17}/><span>{ch.name}</span>{ch.name === 'geral' && <span className="channel-unread"/>}</button>)}
        <div className="side-section-title voice-title"><span>CANAIS DE VOZ</span><button title="Explorar canais" onClick={() => setModal('discover')}><Plus size={15}/></button></div>
        {voiceChannels.map(ch => <button key={ch.id} className={`channel-row ${ch.id === activeChannel?.id ? 'active' : ''}`} onClick={() => { setChannelId(ch.id); setMobileNavOpen(false); }}><Volume2 size={17}/><span>{ch.name}</span>{ch.id === activeChannel?.id && voiceCreds && <span className="channel-live-dot"/>}</button>)}
        {activeChannel?.type === 'voice' && voiceCreds && <div className="voice-roster"><div className="roster-item"><Avatar name={username} size="sm"/><span>{username} (você)</span><Mic size={13}/></div></div>}
        <div className="sidebar-promo"><div className="promo-icon"><Sparkles size={17}/></div><div><strong>Seu espaço, suas regras</strong><p>Crie uma comunidade e convide seus amigos.</p><button onClick={() => setModal('create')}>Criar comunidade <ArrowUpRight size={13}/></button></div></div>
      </div>
      <div className="user-panel"><div className="user-main"><Avatar name={username || 'Visitante'} size="md"/><div className="user-label"><strong>{username || 'Visitante'}</strong><span><span className={`status-dot ${socketReady ? 'online' : 'offline'}`}/>{socketReady ? 'Online' : 'Conectando...'}</span></div></div><div className="user-actions"><button title="Configurações do perfil" onClick={() => { setUsernameDraft(username); setModal('profile'); }}><Settings size={17}/></button><button title="Notificações" onClick={() => setCommunityError('As notificações serão adicionadas em uma próxima fase.')}><Bell size={17}/></button></div></div>
    </aside>

    <main className="main-panel">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNavOpen(!mobileNavOpen)}><Menu size={19}/></button><div className="breadcrumbs"><span className="crumb-server">{activeCommunity?.name || 'Nexo'}</span><span className="crumb-sep">/</span>{activeChannel?.type === 'text' ? <Hash size={17}/> : <Volume2 size={17}/>}<strong>{activeChannel?.name || 'carregando'}</strong></div><div className="topbar-actions"><div className="connection-indicator"><span className={`status-dot ${socketReady ? 'online' : 'offline'}`}/><span>{socketReady ? 'Conectado' : 'Reconectando'}</span></div><button className="icon-button" title="Buscar" onClick={() => setModal('discover')}><Search size={18}/></button><button className="icon-button" title="Convidar amigos" onClick={() => { void navigator.clipboard?.writeText(window.location.origin); setCommunityError('Link do aplicativo copiado (quando permitido pelo navegador).'); }}><UserRoundPlus size={18}/></button></div></header>

      {communityError && <div className="notice-bar"><span>{communityError}</span><button onClick={() => setCommunityError('')}><X size={14}/></button></div>}

      {!username && <div className="welcome-overlay"><form className="welcome-card" onSubmit={saveUsername}><div className="welcome-logo"><span className="brand-glyph">N</span></div><span className="eyebrow">BEM-VINDO AO NEXO</span><h1>Encontre sua galera.</h1><p>Escolha um nome para entrar nas comunidades de teste. Contas e autenticação completa ficam para a próxima etapa.</p><label>Seu nome<input value={usernameDraft} onChange={e => setUsernameDraft(e.target.value)} placeholder="Ex.: Rafa" minLength={2} maxLength={32} autoFocus required/></label><button className="btn primary full" type="submit">Entrar no Nexo <ArrowUpRight size={16}/></button></form></div>}

      {!activeChannel ? <div className="loading-screen"><div className="loading-ring"/><h3>Preparando seu espaço</h3><p>Conectando aos canais do Nexo Voice...</p></div> : activeChannel.type === 'text' ? <section className="chat-layout">
        <div className="chat-main">
          <div className="channel-welcome"><div className="welcome-hash"><Hash size={28}/></div><h1>Bem-vindo a #{activeChannel.name}!</h1><p>Este é o começo do canal. Compartilhe novidades, links e combine a próxima partida.</p><div className="welcome-tags"><span><ShieldCheck size={13}/> Comunidade pública</span><span><Users size={13}/> {onlineCount} online</span></div></div>
          <div className="messages-list">{messages.map((message, index) => <article className={`message ${index > 0 && messages[index - 1].author === message.author ? 'message-consecutive' : ''}`} key={message.id}>{(index === 0 || messages[index - 1].author !== message.author) ? <Avatar name={message.author} size="md"/> : <div className="message-gutter-time">{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>}<div className="message-body">{(index === 0 || messages[index - 1].author !== message.author) && <div className="message-meta"><strong>{message.author}</strong><time>{new Date(message.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div>}<p>{message.text}</p></div></article>)}<div ref={messagesEndRef}/></div>
          <form className="message-composer" onSubmit={sendMessage}><button type="button" className="composer-add" title="Anexos serão adicionados depois" onClick={() => setCommunityError('Upload de arquivos não faz parte deste primeiro MVP.')}><Plus size={19}/></button><textarea value={messageDraft} onChange={e => setMessageDraft(e.target.value)} onKeyDown={onChannelKey} placeholder={`Enviar mensagem para #${activeChannel.name}`} rows={1} maxLength={2000} disabled={!username}/><button type="submit" className="send-button" disabled={!messageDraft.trim() || !username} title="Enviar mensagem"><Send size={17}/></button><div className="composer-hint">Enter para enviar · Shift + Enter para nova linha</div></form>
        </div>
        <aside className="member-sidebar"><div className="member-heading"><span>MEMBROS</span><span className="member-count">{Math.max(onlineCount, 1)}</span></div><div className="member-group-title"><span className="status-dot online"/> ONLINE — {Math.max(onlineCount, 1)}</div>{(presence.length ? presence : [{ id: 'you', name: username || 'Você' }]).map(user => <div className="member-row" key={user.id}><Avatar name={user.name} size="md"/><div><strong>{user.name}{user.name === username ? ' (você)' : ''}</strong><span>{user.name === username ? 'No Nexo Voice' : 'Disponível'}</span></div><span className="member-presence"/></div>)}<div className="member-sidebar-footer"><Activity size={15}/><span>Presença em tempo real neste MVP</span></div></aside>
      </section> : <section className="voice-page">
        <div className="voice-page-backdrop"><div className="ambient ambient-one"/><div className="ambient ambient-two"/></div>
        {!voiceCreds ? <div className="voice-join-card"><div className="voice-join-icon"><Headphones size={30}/></div><span className="eyebrow">CANAL DE VOZ</span><h1>{activeChannel.name}</h1><p>Entre para conversar com a galera. Você poderá ativar seu microfone e compartilhar uma janela ou sua tela.</p><div className="voice-feature-row"><span><Mic size={15}/> Áudio em tempo real</span><span><MonitorUp size={15}/> Compartilhar tela</span></div>{!liveKitConfigured && <div className="config-warning"><Wifi size={16}/><div><strong>Voz ainda não configurada</strong><span>Configure as credenciais LiveKit no backend. O texto continua funcional.</span></div></div>}{voiceError && <div className="inline-error"><X size={15}/>{voiceError}</div>}<button className="btn primary join-button" onClick={joinVoice} disabled={voiceConnecting || !username}>{voiceConnecting ? <><span className="spinner"/> Conectando...</> : <><Headphones size={17}/> Entrar na voz</>}</button><span className="voice-join-footnote"><ShieldCheck size={13}/> Seu microfone só será ativado após sua permissão.</span></div> : <LiveKitRoom token={voiceCreds.token} serverUrl={voiceCreds.serverUrl} connect={true} audio={false} video={false} onDisconnected={() => setVoiceCreds(null)} onError={(error) => setVoiceError(error.message)} options={{ adaptiveStream: true, dynacast: true }}><VoiceStage onLeave={() => setVoiceCreds(null)}/></LiveKitRoom>}
      </section>}

      <footer className="status-footer"><div><span className={`status-dot ${socketReady ? 'online' : 'offline'}`}/><span>{socketReady ? 'Serviço conectado' : 'Tentando conectar ao servidor'}</span></div><span>NEXO VOICE <span className="footer-version">MVP 0.1</span></span></footer>
    </main>

    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}><section className="modal-card" role="dialog" aria-modal="true">
      <button className="modal-close" onClick={() => setModal(null)}><X size={18}/></button>
      {modal === 'create' && <><div className="modal-icon purple"><Plus size={22}/></div><span className="eyebrow">COMECE UMA COMUNIDADE</span><h2>Crie seu ponto de encontro.</h2><p>Ela ficará pública neste MVP e terá canais de texto e voz automaticamente.</p><form className="modal-form" onSubmit={createCommunity}><label>Nome da comunidade<input value={communityName} onChange={e => setCommunityName(e.target.value)} maxLength={48} placeholder="Ex.: Amigos do RPG" required minLength={2}/></label><label>Descrição <span className="optional">opcional</span><textarea value={communityDescription} onChange={e => setCommunityDescription(e.target.value)} maxLength={180} placeholder="Sobre o que é a comunidade?" rows={3}/></label>{communityError && <div className="inline-error">{communityError}</div>}<button className="btn primary full" type="submit">Criar comunidade <ArrowUpRight size={16}/></button></form></>}
      {modal === 'discover' && <><div className="modal-icon blue"><Compass size={22}/></div><span className="eyebrow">EXPLORE O NEXO</span><h2>Encontre sua comunidade.</h2><p>Entre em um espaço público ou crie o seu próprio.</p><div className="discover-search"><Search size={17}/><input value={communitySearch} onChange={e => setCommunitySearch(e.target.value)} placeholder="Buscar comunidades..."/></div><div className="discover-list">{visibleCommunities.map(community => <button className="discover-item" key={community.id} onClick={() => { chooseCommunity(community); setModal(null); }}><div className="discover-avatar">{community.name.slice(0, 2).toUpperCase()}</div><div className="discover-info"><strong>{community.name}</strong><span>{community.description || 'Comunidade pública'} · {community.channels.length} canais</span></div><ArrowUpRight size={16}/></button>)}{visibleCommunities.length === 0 && <div className="no-results">Nenhuma comunidade encontrada.</div>}</div><button className="btn secondary full" onClick={() => setModal('create')}><Plus size={16}/> Criar comunidade</button></>}
      {modal === 'profile' && <><div className="modal-icon blue"><Settings size={22}/></div><span className="eyebrow">SEU PERFIL</span><h2>Como você aparece?</h2><p>Escolha o nome exibido nas mensagens e nas salas de voz.</p><form className="modal-form" onSubmit={saveUsername}><label>Nome de exibição<input value={usernameDraft} onChange={e => setUsernameDraft(e.target.value)} maxLength={32} minLength={2} required/></label><button className="btn primary full" type="submit"><Check size={16}/> Salvar perfil</button></form><div className="profile-note"><ShieldCheck size={15}/> No MVP, este nome não representa uma conta autenticada. Não use isso ainda para salas privadas sensíveis.</div></>}
    </section></div>}
  </div>;
}
