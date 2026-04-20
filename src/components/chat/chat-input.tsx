'use client'

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { Send, Square } from 'lucide-react'
import { cn } from '@/utils/cn'

interface ChatInputProps {
  disabled?: boolean
  isStreaming: boolean
  placeholder?: string
  onSend: (text: string) => void
  onCancel: () => void
}

const MAX_HEIGHT = 200

/**
 * Auto-growing composer. Enter sends, Shift+Enter inserts a newline, Esc
 * cancels the active stream. The send button swaps to a stop button while
 * the assistant is streaming so users always have a single action target.
 */
export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    { disabled = false, isStreaming, placeholder, onSend, onCancel },
    ref,
  ) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null)
    const [value, setValue] = useState('')

    const setRefs = useCallback(
      (el: HTMLTextAreaElement | null) => {
        innerRef.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      },
      [ref],
    )

    // Auto-grow.
    useEffect(() => {
      const el = innerRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
    }, [value])

    const submit = useCallback(() => {
      const text = value.trim()
      if (!text || disabled || isStreaming) return
      onSend(text)
      setValue('')
    }, [value, disabled, isStreaming, onSend])

    return (
      <div className="border-border bg-bg flex items-end gap-2 border-t p-2">
        <textarea
          ref={setRefs}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape' && isStreaming) {
              e.preventDefault()
              onCancel()
            }
          }}
          rows={1}
          placeholder={placeholder ?? 'Ask about this document…'}
          disabled={disabled}
          className={cn(
            'text-fg placeholder:text-fg-muted flex-1 resize-none bg-transparent px-2 py-1.5 text-sm',
            'focus:outline-none disabled:opacity-60',
          )}
          style={{ maxHeight: `${MAX_HEIGHT}px` }}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onCancel}
            className="bg-danger text-accent-fg flex size-8 shrink-0 items-center justify-center rounded-md transition-colors hover:opacity-90"
            title="Stop generating (Esc)"
          >
            <Square className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || value.trim().length === 0}
            className={cn(
              'bg-accent text-accent-fg flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
              'hover:bg-accent-hover disabled:opacity-40',
            )}
            title="Send (Enter)"
          >
            <Send className="size-4" />
          </button>
        )}
      </div>
    )
  },
)
