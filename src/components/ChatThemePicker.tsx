import { Check, Palette, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';

export type ChatThemeId =
  | 'aurora' | 'lagoon' | 'iris' | 'rosewater' | 'apricot'
  | 'moss' | 'ember' | 'midnight' | 'porcelain' | 'stone'
  | 'amethyst' | 'blue-hour' | 'citrine' | 'blush' | 'forest'
  | 'sapphire' | 'cocoa' | 'coral' | 'ice' | 'obsidian';

export interface ChatTheme {
  id: ChatThemeId;
  name: string;
  preview: string;
  variables: CSSProperties;
}

const theme = (id: ChatThemeId, name: string, preview: string, wallpaper: string, me: string, meBorder: string, them: string, themBorder: string): ChatTheme => ({
  id, name, preview,
  variables: {
    '--chat-wallpaper': wallpaper,
    '--bubble-me-bg': me,
    '--bubble-me-border': meBorder,
    '--bubble-them-bg': them,
    '--bubble-them-border': themBorder,
  } as CSSProperties,
});

export const CHAT_THEMES: ChatTheme[] = [
  theme('aurora', 'Aurora', 'linear-gradient(135deg,#81eadb,#539af0)', 'radial-gradient(circle at 10% 5%,rgba(129,234,219,.22),transparent 35%),radial-gradient(circle at 95% 96%,rgba(83,154,240,.22),transparent 42%)', 'rgba(27,100,108,.82)', 'rgba(129,234,219,.65)', 'rgba(54,73,96,.56)', 'rgba(225,245,255,.18)'),
  theme('lagoon', 'Lagoon', 'linear-gradient(135deg,#65e0dd,#2073c8)', 'radial-gradient(circle at 8% 4%,rgba(101,224,221,.18),transparent 38%),radial-gradient(circle at 96% 96%,rgba(32,115,200,.21),transparent 45%)', 'rgba(15,98,119,.84)', 'rgba(91,229,224,.62)', 'rgba(41,71,100,.56)', 'rgba(192,233,255,.16)'),
  theme('iris', 'Iris', 'linear-gradient(135deg,#d6b8ff,#7785ff)', 'radial-gradient(circle at 5% 2%,rgba(214,184,255,.24),transparent 36%),radial-gradient(circle at 100% 100%,rgba(119,133,255,.22),transparent 46%)', 'rgba(94,76,154,.82)', 'rgba(214,184,255,.64)', 'rgba(66,65,103,.58)', 'rgba(231,224,255,.17)'),
  theme('rosewater', 'Rosewater', 'linear-gradient(135deg,#ffc2d7,#e171a3)', 'radial-gradient(circle at 4% 5%,rgba(255,194,215,.23),transparent 37%),radial-gradient(circle at 98% 98%,rgba(225,113,163,.20),transparent 44%)', 'rgba(143,66,101,.84)', 'rgba(255,192,218,.62)', 'rgba(100,61,82,.57)', 'rgba(255,224,237,.16)'),
  theme('apricot', 'Apricot', 'linear-gradient(135deg,#ffd39a,#ed925f)', 'radial-gradient(circle at 8% 4%,rgba(255,211,154,.24),transparent 36%),radial-gradient(circle at 96% 96%,rgba(237,146,95,.19),transparent 44%)', 'rgba(151,83,43,.83)', 'rgba(255,211,151,.62)', 'rgba(96,65,55,.57)', 'rgba(255,231,209,.16)'),
  theme('moss', 'Moss', 'linear-gradient(135deg,#c0e8b7,#5ca782)', 'radial-gradient(circle at 6% 3%,rgba(192,232,183,.23),transparent 38%),radial-gradient(circle at 97% 98%,rgba(92,167,130,.21),transparent 45%)', 'rgba(56,112,80,.84)', 'rgba(190,231,182,.60)', 'rgba(55,79,68,.58)', 'rgba(218,246,224,.16)'),
  theme('ember', 'Ember', 'linear-gradient(135deg,#ffbd8d,#d75849)', 'radial-gradient(circle at 6% 5%,rgba(255,189,141,.21),transparent 36%),radial-gradient(circle at 97% 94%,rgba(215,88,73,.21),transparent 44%)', 'rgba(143,61,47,.85)', 'rgba(255,183,135,.61)', 'rgba(93,55,53,.58)', 'rgba(255,223,214,.16)'),
  theme('midnight', 'Midnight', 'linear-gradient(135deg,#6a88ba,#293b6f)', 'radial-gradient(circle at 5% 3%,rgba(106,136,186,.20),transparent 38%),radial-gradient(circle at 96% 98%,rgba(41,59,111,.28),transparent 45%)', 'rgba(48,76,134,.86)', 'rgba(119,155,221,.52)', 'rgba(42,54,82,.61)', 'rgba(196,215,255,.15)'),
  theme('porcelain', 'Porcelain', 'linear-gradient(135deg,#f4f7ff,#9fb7d6)', 'radial-gradient(circle at 8% 3%,rgba(242,247,255,.23),transparent 36%),radial-gradient(circle at 96% 98%,rgba(159,183,214,.18),transparent 45%)', 'rgba(65,102,137,.84)', 'rgba(214,237,255,.61)', 'rgba(92,108,129,.55)', 'rgba(244,250,255,.21)'),
  theme('stone', 'Stone', 'linear-gradient(135deg,#d4cec4,#7d8795)', 'radial-gradient(circle at 5% 3%,rgba(212,206,196,.17),transparent 38%),radial-gradient(circle at 96% 98%,rgba(125,135,149,.22),transparent 45%)', 'rgba(83,91,104,.87)', 'rgba(213,217,222,.46)', 'rgba(68,77,91,.61)', 'rgba(231,233,237,.15)'),
  theme('amethyst', 'Amethyst', 'linear-gradient(135deg,#e3b5ff,#a15ee4)', 'radial-gradient(circle at 5% 3%,rgba(227,181,255,.22),transparent 36%),radial-gradient(circle at 96% 98%,rgba(161,94,228,.23),transparent 45%)', 'rgba(111,59,156,.85)', 'rgba(226,177,255,.62)', 'rgba(73,55,95,.59)', 'rgba(240,220,255,.16)'),
  theme('blue-hour', 'Blue Hour', 'linear-gradient(135deg,#9bc5ff,#4d6ee8)', 'radial-gradient(circle at 5% 3%,rgba(155,197,255,.22),transparent 36%),radial-gradient(circle at 96% 98%,rgba(77,110,232,.24),transparent 46%)', 'rgba(54,82,172,.85)', 'rgba(143,188,255,.62)', 'rgba(50,64,111,.59)', 'rgba(209,226,255,.16)'),
  theme('citrine', 'Citrine', 'linear-gradient(135deg,#ffe59b,#e4b742)', 'radial-gradient(circle at 5% 3%,rgba(255,229,155,.22),transparent 36%),radial-gradient(circle at 96% 98%,rgba(228,183,66,.20),transparent 45%)', 'rgba(144,106,34,.85)', 'rgba(255,229,149,.60)', 'rgba(93,78,48,.59)', 'rgba(255,241,192,.16)'),
  theme('blush', 'Blush', 'linear-gradient(135deg,#ffd1d9,#da8294)', 'radial-gradient(circle at 5% 3%,rgba(255,209,217,.22),transparent 36%),radial-gradient(circle at 96% 98%,rgba(218,130,148,.20),transparent 45%)', 'rgba(151,76,95,.85)', 'rgba(255,203,214,.60)', 'rgba(100,64,76,.58)', 'rgba(255,229,234,.16)'),
  theme('forest', 'Forest', 'linear-gradient(135deg,#9fd7ae,#27745f)', 'radial-gradient(circle at 5% 3%,rgba(159,215,174,.20),transparent 36%),radial-gradient(circle at 96% 98%,rgba(39,116,95,.23),transparent 46%)', 'rgba(38,100,74,.86)', 'rgba(146,220,167,.56)', 'rgba(42,75,65,.60)', 'rgba(211,245,222,.15)'),
  theme('sapphire', 'Sapphire', 'linear-gradient(135deg,#80caff,#2563d7)', 'radial-gradient(circle at 5% 3%,rgba(128,202,255,.22),transparent 36%),radial-gradient(circle at 96% 98%,rgba(37,99,215,.23),transparent 46%)', 'rgba(35,89,170,.86)', 'rgba(119,190,255,.60)', 'rgba(40,62,111,.60)', 'rgba(206,229,255,.16)'),
  theme('cocoa', 'Cocoa', 'linear-gradient(135deg,#e2b68f,#895843)', 'radial-gradient(circle at 5% 3%,rgba(226,182,143,.20),transparent 36%),radial-gradient(circle at 96% 98%,rgba(137,88,67,.23),transparent 46%)', 'rgba(116,73,52,.87)', 'rgba(225,177,137,.55)', 'rgba(83,61,56,.61)', 'rgba(247,220,201,.15)'),
  theme('coral', 'Coral', 'linear-gradient(135deg,#ffb59e,#e76665)', 'radial-gradient(circle at 5% 3%,rgba(255,181,158,.22),transparent 36%),radial-gradient(circle at 96% 98%,rgba(231,102,101,.21),transparent 46%)', 'rgba(155,70,66,.86)', 'rgba(255,174,153,.59)', 'rgba(104,60,62,.59)', 'rgba(255,222,216,.16)'),
  theme('ice', 'Ice', 'linear-gradient(135deg,#d0fbff,#73b6d6)', 'radial-gradient(circle at 5% 3%,rgba(208,251,255,.22),transparent 36%),radial-gradient(circle at 96% 98%,rgba(115,182,214,.20),transparent 46%)', 'rgba(49,112,132,.85)', 'rgba(184,244,250,.59)', 'rgba(53,79,91,.59)', 'rgba(221,251,255,.16)'),
  theme('obsidian', 'Obsidian', 'linear-gradient(135deg,#8d9ab1,#252b38)', 'radial-gradient(circle at 5% 3%,rgba(141,154,177,.16),transparent 36%),radial-gradient(circle at 96% 98%,rgba(37,43,56,.27),transparent 46%)', 'rgba(58,68,88,.88)', 'rgba(159,178,210,.42)', 'rgba(35,42,56,.68)', 'rgba(213,223,239,.12)'),
];

interface ChatThemePickerProps {
  activeThemeId: ChatThemeId;
  onSelect: (themeId: ChatThemeId) => void;
  onClose: () => void;
}

export function ChatThemePicker({ activeThemeId, onSelect, onClose }: ChatThemePickerProps) {
  return createPortal(<>
    <button className="fixed inset-0 z-[90] cursor-default bg-black/35 backdrop-blur-sm" onClick={onClose} aria-label="Close chat themes" />
    <section role="dialog" aria-modal="true" aria-label="Chat themes" className="chat-theme-picker fixed z-[100] left-1/2 top-1/2 w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-5">
      <header className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--surface4)] text-[var(--accent)]"><Palette className="h-5 w-5" /></span><div><h2 className="text-lg font-extrabold tracking-[-.04em] text-[var(--txt)]">Chat theme</h2><p className="text-xs text-[var(--txt2)]">Just for this conversation.</p></div><button onClick={onClose} className="ml-auto grid h-9 w-9 place-items-center rounded-xl text-[var(--txt3)] hover:bg-[var(--surface4)] hover:text-[var(--txt)]" aria-label="Close chat themes"><X className="h-4 w-4" /></button></header>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CHAT_THEMES.map(item => { const active = item.id === activeThemeId; return <button key={item.id} onClick={() => onSelect(item.id)} className={active ? 'chat-theme-card chat-theme-card-active' : 'chat-theme-card'}>
          <span className="chat-theme-preview" style={{ background: item.preview }}><span /><span /></span><span className="mt-2 flex items-center justify-between text-left text-xs font-bold text-[var(--txt)]">{item.name}{active && <Check className="h-3.5 w-3.5 text-[var(--accent)]" />}</span>
        </button>; })}
      </div>
    </section>
  </>, document.body);
}
