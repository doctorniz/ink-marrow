import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
          'focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
          'disabled:pointer-events-none disabled:opacity-50',
          variant === 'primary' &&
            'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
          variant === 'secondary' &&
            'border-border-strong hover:bg-bg-hover border bg-bg shadow-sm',
          variant === 'ghost' && 'hover:bg-bg-hover text-fg',
          variant === 'danger' && 'bg-danger text-white hover:opacity-90',
          size === 'sm' && 'h-8 px-3 text-sm',
          size === 'md' && 'h-10 px-4 text-sm',
          size === 'lg' && 'h-11 px-6 text-base',
          className,
        )}
        {...props}
      />
    )
  },
)

Button.displayName = 'Button'
