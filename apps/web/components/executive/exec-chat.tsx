'use client';
import * as React from 'react';
import { Send, Plus, Star, Loader2, Bot, User } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { sendChatMessage, listChatSessions } from '@/lib/executive-api';

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  pinned?: boolean;
  pending?: boolean;
}

export function ExecChat() {
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [input, setInput] = React.useState('');
  const [messages, setMessages] = React.useState<LocalMessage[]>([]);
  const [pinnedIds, setPinnedIds] = React.useState<Set<string>>(new Set());
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  useQuery({
    queryKey: ['exec-chat-sessions'],
    queryFn: listChatSessions,
  });

  const sendMutation = useMutation({
    mutationFn: ({ sid, msg }: { sid: string | null; msg: string }) =>
      sendChatMessage(sid, msg),
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setMessages((prev) =>
        prev
          .filter((m) => !m.pending)
          .concat({
            id: data.message.id,
            role: 'assistant',
            content: data.message.content,
            toolsUsed: data.message.toolsUsed,
          }),
      );
      qc.invalidateQueries({ queryKey: ['exec-chat-sessions'] });
    },
    onError: () => {
      setMessages((prev) => prev.filter((m) => !m.pending));
    },
  });

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    const userMsg: LocalMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    const pendingMsg: LocalMessage = { id: `p-${Date.now()}`, role: 'assistant', content: '', pending: true };
    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setInput('');
    sendMutation.mutate({ sid: sessionId, msg: text });
  }

  function handleNewChat() {
    setSessionId(null);
    setMessages([]);
    setInput('');
  }

  function togglePin(id: string) {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-sm font-medium">Executive Assistant</p>
        <Button variant="ghost" size="sm" onClick={handleNewChat} className="h-7 gap-1 text-xs">
          <Plus className="size-3" aria-hidden /> New
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 p-3">
        {messages.length === 0 && !sendMutation.isPending && (
          <EmptyState
            icon={Bot}
            title="Executive Assistant"
            description="Ask about portfolio health, branch performance, approvals or generate insights."
            className="py-8"
          />
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'flex gap-2',
              msg.role === 'user' ? 'flex-row-reverse' : 'flex-row',
            )}
          >
            <div
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-xs',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {msg.role === 'user' ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
            </div>
            <div className={cn('group relative max-w-[85%]', msg.role === 'user' ? 'items-end' : 'items-start')}>
              {msg.pending ? (
                <Card className="flex items-center gap-2 px-3 py-2">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Thinking" />
                  <span className="text-sm text-muted-foreground">Thinking…</span>
                </Card>
              ) : (
                <Card
                  className={cn(
                    'px-3 py-2 text-sm leading-relaxed',
                    msg.role === 'user' && 'bg-primary text-primary-foreground border-primary/20',
                    pinnedIds.has(msg.id) && 'ring-1 ring-yellow-400/60',
                  )}
                >
                  {msg.content}
                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {msg.toolsUsed.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px] py-0">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Card>
              )}
              {!msg.pending && msg.role === 'assistant' && (
                <button
                  type="button"
                  onClick={() => togglePin(msg.id)}
                  aria-label={pinnedIds.has(msg.id) ? 'Unpin message' : 'Pin message'}
                  className={cn(
                    'absolute -right-6 top-1 opacity-0 transition-opacity group-hover:opacity-100',
                    pinnedIds.has(msg.id) && 'opacity-100',
                  )}
                >
                  <Star
                    className={cn(
                      'size-3.5',
                      pinnedIds.has(msg.id) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground',
                    )}
                  />
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask the executive assistant…"
            disabled={sendMutation.isPending}
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            style={{ maxHeight: 120 }}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || sendMutation.isPending}
            aria-label="Send message"
            className="shrink-0 self-end"
          >
            {sendMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
