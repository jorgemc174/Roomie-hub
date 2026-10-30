'use client';
import type { Locale } from '@/lib/i18n/dictionaries';
import { chatMessages } from './messages';
import { emojis, type ChatPage } from './models';

export function MessageActions({
  locale,
  pending,
  own,
  reactions,
  onReply,
  onEdit,
  onRemove,
  onReaction,
}: {
  locale: Locale;
  pending: boolean;
  own: boolean;
  reactions: ChatPage['reactions'];
  onReply: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onReaction: (emoji: string, enabled: boolean) => void;
}) {
  const t = chatMessages(locale);
  return (
    <div className="row wrap">
      <button type="button" disabled={pending} onClick={onReply}>
        {t.reply}
      </button>
      <details className="message-actions">
        <summary>{t.actions}</summary>
        <div className="message-actions-body stack">
          <fieldset className="message-reaction-options">
            <legend>{t.reaction}</legend>
            <div className="row wrap chat-reactions">
              {emojis.map((emoji) => {
                const reaction = reactions.find((r) => r.emoji === emoji);
                return (
                  <button
                    type="button"
                    key={emoji}
                    disabled={pending}
                    aria-label={`${t.reaction} ${emoji}`}
                    aria-pressed={reaction?.mine ?? false}
                    onClick={() => onReaction(emoji, !reaction?.mine)}
                  >
                    {emoji}
                    {reaction?.count ? ` ${reaction.count}` : ''}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="row wrap">
            {own && (
              <button type="button" disabled={pending} onClick={onEdit}>
                {t.edit}
              </button>
            )}
            <button type="button" disabled={pending} onClick={onRemove}>
              {t.remove}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
