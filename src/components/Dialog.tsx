import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "../i18n";

export function Dialog({ title, onClose, busy = false, children }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { locale } = useI18n();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="app-dialog" aria-label={title} tabIndex={-1} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(element => element.getClientRects().length > 0 && !element.matches(":disabled"));
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (!controls.length) { event.preventDefault(); event.currentTarget.focus(); }
    else if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && (index === -1 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
  }} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section onClick={event => event.stopPropagation()}>
      <div className="dialog-title"><h2>{title}</h2><button aria-label={locale === "ru" ? "Закрыть" : "Close"} disabled={busy} onClick={onClose}>×</button></div>
      {children}
    </section>
  </dialog>;
}
