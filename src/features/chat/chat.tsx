'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { useLocale } from '@/lib/i18n/provider';
import { chatMessages } from './messages';
import { chatCommand } from './actions';
import { textParts } from './logic';
import { emojis, type ChatPage, type ChatMessage } from './models';
type Cursor = { created_at: string; id: string } | null;
export function Chat({
  homeId,
  userId,
  timezone,
  initial,
}: {
  homeId: string;
  userId: string;
  timezone: string;
  initial: ChatPage;
}) {
  const locale = useLocale(),
    t = chatMessages(locale);
  const [page, setPage] = useState(initial),
    [cursor, setCursor] = useState<Cursor>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [newMessages, setNewMessages] = useState(false),
    [body, setBody] = useState(''),
    [reply, setReply] = useState<ChatMessage | null>(null),
    [editing, setEditing] = useState<ChatMessage | null>(null),
    [removing, setRemoving] = useState<string | null>(null),
    [files, setFiles] = useState<File[]>([]),
    [connected, setConnected] = useState(true);
  const readVersion = useRef(0);
  const fileIds = useRef<string[]>([]),
    requestId = useRef<string | null>(null),
    scroll = useRef<HTMLDivElement>(null),
    latest = useRef({ cursor: null as Cursor, nearBottom: true }),
    formRef = useRef<HTMLFormElement>(null);
  const refresh = useCallback(
    async (next: Cursor, force = false) => {
      const version = ++readVersion.current;
      const db = browserClient();
      const { data, error } = await db.rpc('chat_page', {
        target: homeId,
        before_at: next?.created_at,
        before_id: next?.id,
      });
      if (version !== readVersion.current) return;
      if (error) {
        setError(t.error);
        return;
      }
      setPage(data as unknown as ChatPage);
      setCursor(next);
      latest.current.cursor = next;
      if (force) {
        setNewMessages(false);
        requestAnimationFrame(() => {
          if (scroll.current) scroll.current.scrollTop = next ? 0 : scroll.current.scrollHeight;
        });
      }
    },
    [homeId, t.error],
  );
  useEffect(() => {
    const db = browserClient();
    let disposed = false;
    let channel: ReturnType<typeof db.channel> | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed)
          void refresh(latest.current.cursor, !latest.current.cursor && latest.current.nearBottom);
      }, 150);
    };
    const connect = async () => {
      const {
        data: { session },
      } = await db.auth.getSession();
      if (disposed || !session) return;
      await db.realtime.setAuth(session.access_token);
      if (disposed) return;
      channel = db.channel(`chat:${homeId}:${crypto.randomUUID()}`, {
        config: { postgres_changes_options: { wait: true, timeout: 15000 } },
      });
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `home_id=eq.${homeId}`,
        },
        () => {
          if (disposed) return;
          if (latest.current.cursor || !latest.current.nearBottom) setNewMessages(true);
          else reload();
        },
      );
      for (const table of ['chat_messages', 'chat_reactions', 'chat_attachments'])
        channel.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table, filter: `home_id=eq.${homeId}` },
          reload,
        );
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_reactions',
          filter: `home_id=eq.${homeId}`,
        },
        reload,
      );
      channel.on('system', {}, (payload) => {
        if (disposed) return;
        setConnected(payload.status === 'ok');
        if (payload.status === 'ok') reload();
      });
      channel.subscribe((status) => {
        if (disposed) return;
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') reload();
      });
    };
    void connect().catch(() => {
      if (!disposed) setConnected(false);
    });
    window.addEventListener('focus', reload);
    window.addEventListener('online', reload);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('focus', reload);
      window.removeEventListener('online', reload);
      if (channel) void db.removeChannel(channel);
    };
  }, [homeId, refresh]);
  async function command(operation: string, form: FormData) {
    if (!navigator.onLine) {
      setError(t.offline);
      return false;
    }
    setPending(true);
    setError('');
    try {
      const result = await chatCommand(homeId, operation, form);
      if (result.error) {
        setError(result.error);
        return false;
      }
      await refresh(cursor, operation === 'send' && !cursor);
      return true;
    } catch {
      setError(t.error);
      return false;
    } finally {
      setPending(false);
    }
  }
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData();
    if (!requestId.current) requestId.current = crypto.randomUUID();
    f.set('id', editing?.id ?? requestId.current);
    f.set('body', body);
    f.set('reply', reply?.id ?? '');
    f.set('version', String(editing?.version ?? 0));
    for (const [i, file] of files.entries()) {
      f.append('files', file);
      f.append('file_ids', fileIds.current[i]);
    }
    if (await command(editing ? 'edit' : 'send', f)) {
      setBody('');
      setFiles([]);
      fileIds.current = [];
      requestId.current = null;
      setReply(null);
      setEditing(null);
      formRef.current?.reset();
    }
  }
  const changeDraft = (value: string) => {
    setBody(value);
    requestId.current = null;
  };
  const format = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(value));
  return (
    <div className="chat-shell">
      <p className="muted text-sm">{t.removedPolicy}</p>
      {(!connected || error) && (
        <p role="alert" className="notice error">
          {error || t.error}{' '}
          <button type="button" onClick={() => void refresh(cursor)}>
            {t.reload}
          </button>
        </p>
      )}
      <div className="row wrap">
        <button
          disabled={pending || page.messages.length < 50}
          onClick={() => void refresh(page.messages[0] ?? null, true)}
        >
          {t.older}
        </button>
        {cursor && <button onClick={() => void refresh(null, true)}>{t.recent}</button>}
        {newMessages && (
          <button className="primary" onClick={() => void refresh(null, true)}>
            {t.newMessages}
          </button>
        )}
      </div>
      <div
        ref={scroll}
        className="chat-log"
        role="log"
        aria-label={t.title}
        aria-live="off"
        tabIndex={0}
        onScroll={() => {
          const e = scroll.current;
          if (e) latest.current.nearBottom = e.scrollHeight - e.scrollTop - e.clientHeight < 80;
        }}
      >
        {!page.messages.length && <p className="muted">{t.empty}</p>}
        {page.messages.map((m) => {
          const original = page.replies.find((x) => x.id === m.reply_to);
          return (
            <article
              data-message-id={m.id}
              key={m.id}
              className={`chat-message ${m.author_user_id === userId ? 'own' : ''}`}
            >
              <header className="row wrap">
                <strong>{m.author_name}</strong>
                <time dateTime={m.created_at} className="muted text-sm">
                  {format(m.created_at)}
                </time>
                {m.edited_at && <small>{t.edited}</small>}
              </header>
              {original && (
                <blockquote>
                  <strong>{original.author_name}</strong>
                  <p>{original.deleted_at ? t.deleted : original.body.slice(0, 160)}</p>
                </blockquote>
              )}
              <p className="chat-text">
                {m.deleted_at ? (
                  <em>{t.deleted}</em>
                ) : (
                  textParts(m.body).map((p, i) =>
                    p.href ? (
                      <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow">
                        {p.text}
                      </a>
                    ) : (
                      p.text
                    ),
                  )
                )}
              </p>
              {!m.deleted_at && (
                <>
                  <div className="stack">
                    {page.attachments
                      .filter((a) => a.message_id === m.id)
                      .map((a) => (
                        <a
                          key={a.id}
                          href={`/homes/${homeId}/chat/file/${a.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="chat-file"
                        >
                          {a.mime === 'image/webp' && (
                            <img
                              src={`/homes/${homeId}/chat/file/${a.id}`}
                              alt={a.file_name}
                              width={240}
                              height={180}
                              loading="lazy"
                            />
                          )}
                          <span>
                            {t.download}: {a.file_name} ·{' '}
                            {new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                              a.size / 1024,
                            )}{' '}
                            KiB
                          </span>
                        </a>
                      ))}
                  </div>
                  <div className="row wrap chat-reactions">
                    {emojis.map((emoji) => {
                      const r = page.reactions.find(
                        (r) => r.message_id === m.id && r.emoji === emoji,
                      );
                      return (
                        <button
                          key={emoji}
                          disabled={pending}
                          aria-label={`${t.reaction} ${emoji}`}
                          aria-pressed={r?.mine ?? false}
                          onClick={() => {
                            const f = new FormData();
                            f.set('id', m.id);
                            f.set('emoji', emoji);
                            f.set('enabled', String(!r?.mine));
                            void command('reaction', f);
                          }}
                        >
                          {emoji} {r?.count || ''}
                        </button>
                      );
                    })}
                  </div>
                  <div className="row wrap">
                    <button
                      disabled={pending}
                      onClick={() => {
                        setReply(m);
                        setEditing(null);
                        formRef.current?.querySelector('textarea')?.focus();
                      }}
                    >
                      {t.reply}
                    </button>
                    {m.author_user_id === userId && (
                      <button
                        disabled={pending}
                        onClick={() => {
                          setEditing(m);
                          setBody(m.body);
                          setReply(null);
                          setFiles([]);
                          formRef.current?.querySelector('textarea')?.focus();
                        }}
                      >
                        {t.edit}
                      </button>
                    )}
                    <button disabled={pending} onClick={() => setRemoving(m.id)}>
                      {t.remove}
                    </button>
                  </div>
                  {removing === m.id && (
                    <div className="notice">
                      <button
                        disabled={pending}
                        onClick={async () => {
                          const f = new FormData();
                          f.set('id', m.id);
                          f.set('version', String(m.version));
                          if (await command('delete', f)) setRemoving(null);
                        }}
                      >
                        {t.confirm}
                      </button>{' '}
                      <button onClick={() => setRemoving(null)}>{t.cancel}</button>
                    </div>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
      <form onSubmit={send} ref={formRef} className="panel stack">
        {(reply || editing) && (
          <div className="row wrap">
            <span>{editing ? t.edit : `${t.replying} ${reply?.author_name}`}</span>
            <button
              type="button"
              onClick={() => {
                setReply(null);
                setEditing(null);
                setBody('');
              }}
            >
              {t.cancel}
            </button>
          </div>
        )}
        <label>
          {t.message}
          <textarea
            aria-label={t.message}
            name="body"
            maxLength={4000}
            rows={3}
            value={body}
            onChange={(e) => changeDraft(e.target.value)}
            disabled={pending}
          />
        </label>
        {!editing && (
          <label>
            {t.attach}
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
              disabled={pending}
              onChange={(e) => {
                const selected = Array.from(e.target.files ?? []);
                if (selected.length > 3 || selected.some((f) => f.size > 10 * 1024 * 1024)) {
                  setError(t.invalid);
                  e.target.value = '';
                  setFiles([]);
                  return;
                }
                setFiles(selected);
                fileIds.current = selected.map(() => crypto.randomUUID());
                requestId.current = null;
              }}
            />
            <small className="muted">{t.fileHint}</small>
          </label>
        )}
        <button
          className="primary"
          disabled={pending || (!body.trim() && !files.length && !editing)}
        >
          {pending ? t.sending : editing ? t.save : t.send}
        </button>
      </form>
    </div>
  );
}
