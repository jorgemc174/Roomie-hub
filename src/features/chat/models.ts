export type ChatMessage = {
  id: string;
  home_id: string;
  author_user_id: string;
  author_name: string;
  body: string;
  reply_to: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  version: number;
};
export type ChatAttachment = {
  id: string;
  home_id: string;
  message_id: string | null;
  uploaded_by: string;
  path: string;
  file_name: string;
  mime: string;
  size: number;
  created_at: string;
};
export type ChatReaction = {
  home_id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  active: boolean;
  updated_at: string;
};
export type ChatPage = {
  messages: ChatMessage[];
  replies: ChatMessage[];
  attachments: ChatAttachment[];
  reactions: { message_id: string; emoji: string; count: number; mine: boolean }[];
};
export const emojis = ['👍', '❤️', '😂', '🎉', '😮', '🙏'] as const;
