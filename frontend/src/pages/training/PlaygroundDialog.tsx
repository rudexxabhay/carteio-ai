import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { getAssistantTrainingOverview, type Assistant, type AssistantTrainingOverview } from '../../services/api/assistants';
import { PlaygroundChat } from './PlaygroundChat';
import './playground-dialog.css';

export function PlaygroundDialog({ workspaceSlug, assistantId, manager, onClose, onAssistantUpdated }: { workspaceSlug: string; assistantId: string; manager: boolean; onClose: () => void; onAssistantUpdated: (assistant: Assistant) => void }) {
  const [overview, setOverview] = useState<AssistantTrainingOverview | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOverview(null);
    setError('');
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>('button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])')?.focus());
    const controller = new AbortController();
    getAssistantTrainingOverview(workspaceSlug, assistantId, controller.signal).then((result) => { if (!controller.signal.aborted) setOverview(result); }).catch(() => { if (!controller.signal.aborted) setError('Assistant details could not be loaded. Please try again.'); });
    return () => {
      controller.abort();
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      opener.current?.focus();
    };
  }, [workspaceSlug, assistantId]);

  useEffect(() => {
    if (!overview) return;
    requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>('.playground-header [aria-label="Start a new chat"]')?.focus());
  }, [overview]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter((item) => item.offsetParent !== null);
    if (!focusable.length) { event.preventDefault(); dialog.current.focus(); return; }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div className="playground-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="playground-dialog" role="dialog" aria-modal="true" aria-labelledby="playground-dialog-title" tabIndex={-1} onKeyDown={onKeyDown}>
      {overview ? <PlaygroundChat key={`${workspaceSlug}:${assistantId}`} workspaceSlug={workspaceSlug} assistant={overview.assistant} manager={manager} onAssistantUpdated={(assistant) => { setOverview((current) => current ? { ...current, assistant } : current); onAssistantUpdated(assistant); }} onClose={onClose}/> : <><header className="playground-error-header"><h2 id="playground-dialog-title">Chat Playground</h2><button type="button" className="playground-dialog-close" onClick={onClose} aria-label="Close chat playground"><X size={18}/></button></header>{error ? <div className="playground-dialog-state" role="alert"><p>{error}</p><button className="button button-secondary" onClick={() => { setError(''); const controller = new AbortController(); getAssistantTrainingOverview(workspaceSlug, assistantId, controller.signal).then(setOverview).catch(() => setError('Assistant details could not be loaded. Please try again.')); }}><RefreshCw size={14}/> Try again</button></div> : <p className="playground-dialog-state" role="status">Loading assistant configuration…</p>}</>}
    </section>
  </div>;
}
