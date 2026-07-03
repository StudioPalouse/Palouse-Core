import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@palouse/ui';

/**
 * Agent- and user-authored markdown (result summaries, task descriptions,
 * comments) rendered with compact styling. react-markdown emits no raw HTML,
 * so untrusted agent output stays inert.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 text-sm leading-relaxed',
        '[&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium',
        '[&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1 [&_ul]:pl-5',
        '[&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-1 [&_ol]:pl-5',
        '[&_a]:underline [&_a]:underline-offset-2',
        '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs',
        '[&_pre]:bg-muted [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_blockquote]:text-muted-foreground [&_blockquote]:border-l-2 [&_blockquote]:pl-3',
        '[&_table]:w-full [&_table]:text-left [&_th]:border-b [&_th]:py-1 [&_th]:pr-3 [&_th]:font-medium [&_td]:py-1 [&_td]:pr-3',
        '[&_hr]:border-border',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
