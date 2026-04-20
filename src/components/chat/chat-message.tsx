'use client'

import { AlertTriangle, Bot, User } from 'lucide-react'
import { renderChatMarkdown } from '@/lib/chat/render-markdown'
import type { ChatMessage as ChatMessageT } from '@/types/chat'
import { cn } from '@/utils/cn'

interface ChatMessageProps {
  message: ChatMessageT
}

/**
 * Single chat bubble. Assistant messages render markdown (sanitized);
 * user messages render as plain text with whitespace preserved so code
 * pastes survive. A streaming cursor is shown at the tail of the
 * in-flight assistant message.
 */
export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const showCursor = isAssistant && message.streaming

  return (
    <div
      className={cn(
        'group flex items-start gap-3 px-3 py-2',
        isUser && 'bg-bg-hover/40 rounded-md',
      )}
    >
      <div
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-accent/15 text-accent' : 'bg-bg-muted text-fg-secondary',
        )}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-fg-secondary mb-0.5 text-xs font-medium">
          {isUser ? 'You' : (message.model ?? 'Assistant')}
        </div>

        {message.error ? (
          <div className="text-danger flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{message.error}</span>
          </div>
        ) : isUser ? (
          <div className="text-fg text-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : (
          <div
            className={cn(
              'text-fg prose prose-sm dark:prose-invert max-w-none text-sm',
              // Match app typography rather than default Tailwind prose.
              'prose-p:my-2 prose-pre:my-2 prose-pre:bg-bg-muted prose-pre:rounded-md prose-code:before:content-none prose-code:after:content-none',
            )}
            dangerouslySetInnerHTML={{
              __html:
                renderChatMarkdown(message.content) +
                (showCursor ? '<span class="chat-cursor">▌</span>' : ''),
            }}
          />
        )}
      </div>
    </div>
  )
}
