import { cn } from '@/lib/utils';

export type Feedback = {
  kind: 'success' | 'error' | 'info';
  text: string;
};

/** One accessible status line for save and connection feedback. */
export function FeedbackMessage({
  feedback,
  className,
}: {
  feedback: Feedback | null;
  className?: string;
}) {
  if (!feedback) return null;

  return (
    <p
      role={feedback.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'm-0 text-sm break-words',
        feedback.kind === 'success' && 'text-emerald-700 dark:text-emerald-400',
        feedback.kind === 'error' && 'text-destructive',
        feedback.kind === 'info' && 'text-muted-foreground',
        className,
      )}
    >
      {feedback.text}
    </p>
  );
}
