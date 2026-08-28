import { Check, Moon, Palette, Sun, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Accent, useTheme } from '../context/ThemeContext';
import { cn } from '../utils';

const accents: { id: Accent; name: string; colors: string }[] = [
  { id: 'aqua', name: 'Tidal', colors: 'from-[#6de7e2] to-[#3988ff]' },
  { id: 'iris', name: 'Iris', colors: 'from-[#c3a6ff] to-[#7478ff]' },
  { id: 'rose', name: 'Rose', colors: 'from-[#ffb6d4] to-[#f06c9b]' },
  { id: 'amber', name: 'Saffron', colors: 'from-[#ffe0a3] to-[#ef9a52]' },
  { id: 'sage', name: 'Verdant', colors: 'from-[#b9e9bd] to-[#51ad92]' },
];

interface AppearanceMenuProps {
  variant?: 'popover' | 'dialog';
  onClose?: () => void;
}

export function AppearanceMenu({ variant = 'popover', onClose }: AppearanceMenuProps) {
  const { theme, accent, setTheme, setAccent } = useTheme();
  const content = <>
    <div className="flex items-center gap-2 px-2 py-1.5"><Palette className="w-3.5 h-3.5 text-[var(--accent)]" /><span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[var(--txt2)]">Appearance</span>{variant === 'dialog' && <button onClick={onClose} className="ml-auto grid w-7 h-7 place-items-center rounded-lg text-[var(--txt3)] hover:bg-[var(--surface4)] hover:text-[var(--txt)]" aria-label="Close appearance settings"><X className="w-4 h-4" /></button>}</div>
    <div className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-[var(--inset)] p-1">
      {(['dark', 'light'] as const).map(option => {
        const active = theme === option; const Icon = option === 'dark' ? Moon : Sun;
        return <button key={option} onClick={() => setTheme(option)} className={cn('flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all', active ? 'appearance-selected' : 'text-[var(--txt3)] hover:text-[var(--txt)]')}><Icon className="w-3.5 h-3.5" /> {option === 'dark' ? 'Dark' : 'Light'}</button>;
      })}
    </div>
    <div className="mt-4 px-2 text-[11px] font-semibold tracking-[0.12em] uppercase text-[var(--txt2)]">Highlight</div>
    <div className="mt-2 space-y-1">{accents.map(item => {
      const active = accent === item.id;
      return <button key={item.id} onClick={() => setAccent(item.id)} className={cn('w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors', active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]')}><span className={cn('w-7 h-7 rounded-full bg-gradient-to-br shadow-[inset_0_1px_rgba(255,255,255,.55),0_3px_8px_rgba(0,0,0,.14)]', item.colors)} /><span className="flex-1 text-xs font-medium text-[var(--txt)]">{item.name}</span>{active && <Check className="w-4 h-4 text-[var(--accent)]" />}</button>;
    })}</div>
  </>;

  if (variant === 'dialog') return createPortal(<>
    <button className="fixed inset-0 z-[90] cursor-default bg-black/25 backdrop-blur-[2px]" onClick={onClose} aria-label="Close appearance settings" />
    <div role="dialog" aria-modal="true" aria-label="Appearance settings" className="appearance-menu fixed z-[100] left-1/2 top-1/2 w-[min(23rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-4">{content}</div>
  </>, document.body);

  return <div className="appearance-menu absolute right-0 top-[calc(100%+10px)] z-[70] w-72 p-3">{content}</div>;
}
