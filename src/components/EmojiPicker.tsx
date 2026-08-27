import React, { useRef, useEffect, useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Search, X } from 'lucide-react';
import { cn } from '../utils';

const CATEGORIES = [
  {
    label: 'Smileys',
    emojis: ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','🙂','🤗','🤩','🤔','😐','🙄','😏','😮','😪','😴','😌','😛','😜','😝','😒','😔','😕','🙃','🤑','😲','😢','😭','😨','😩','🤯','😬','😰','😱','😠','😡','🤬','😷','😇','🥳','🤠','🥺','😻','🤓'],
  },
  {
    label: 'Gestures',
    emojis: ['👍','👎','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👋','🤚','✋','👏','🙌','🤝','🙏','💅','✍️','💪','🫶','🫂'],
  },
  {
    label: 'Hearts',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️'],
  },
  {
    label: 'Fun & Objects',
    emojis: ['🔥','💥','✨','⭐','🌟','💫','🎉','🎊','🎈','🎁','🏆','🥇','💯','🚀','⚡','🌈','☀️','🌙','❄️','💎','👑','🍕','🍔','🌮','🍦','🎂','🥂','😴','💤','💩','👻','💀','🤖','👽'],
  },
  {
    label: 'Animals',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🦋','🐝','🦜','🦄','🐉','🦈','🐬','🦧'],
  },
];

// Flat list with name hints for search matching
const SEARCH_INDEX: { emoji: string; keywords: string }[] = [
  { emoji: '😀', keywords: 'grinning happy smile face' },
  { emoji: '😁', keywords: 'beaming grin happy teeth' },
  { emoji: '😂', keywords: 'joy laugh crying tears funny lol' },
  { emoji: '🤣', keywords: 'rolling laugh floor funny lol rofl' },
  { emoji: '😃', keywords: 'happy smile big eyes' },
  { emoji: '😄', keywords: 'happy smile eyes grin' },
  { emoji: '😅', keywords: 'sweat smile nervous awkward' },
  { emoji: '😆', keywords: 'laugh squint happy grin' },
  { emoji: '😉', keywords: 'wink sly playful' },
  { emoji: '😊', keywords: 'smile blush happy warm' },
  { emoji: '😋', keywords: 'yum delicious taste food' },
  { emoji: '😎', keywords: 'cool sunglasses awesome' },
  { emoji: '😍', keywords: 'heart eyes love adore' },
  { emoji: '🥰', keywords: 'love hearts smiling adore' },
  { emoji: '😘', keywords: 'kiss blow love' },
  { emoji: '🙂', keywords: 'slightly smile neutral happy' },
  { emoji: '🤗', keywords: 'hug warm happy arms' },
  { emoji: '🤩', keywords: 'star struck excited wow amazing' },
  { emoji: '🤔', keywords: 'thinking hmm wondering consider' },
  { emoji: '😐', keywords: 'neutral meh expressionless' },
  { emoji: '🙄', keywords: 'eye roll annoyed whatever' },
  { emoji: '😏', keywords: 'smirk sly smug' },
  { emoji: '😮', keywords: 'surprised open mouth wow' },
  { emoji: '😪', keywords: 'sleepy tired' },
  { emoji: '😴', keywords: 'sleeping sleep zzz tired' },
  { emoji: '😌', keywords: 'relieved calm peaceful' },
  { emoji: '😛', keywords: 'tongue playful silly' },
  { emoji: '😜', keywords: 'wink tongue silly playful' },
  { emoji: '😝', keywords: 'tongue squint silly' },
  { emoji: '😒', keywords: 'unamused annoyed unimpressed' },
  { emoji: '😔', keywords: 'pensive sad down' },
  { emoji: '😕', keywords: 'confused worried' },
  { emoji: '🙃', keywords: 'upside down sarcasm joking' },
  { emoji: '🤑', keywords: 'money mouth rich greedy' },
  { emoji: '😲', keywords: 'astonished shocked wow' },
  { emoji: '😢', keywords: 'cry sad tears' },
  { emoji: '😭', keywords: 'loudly crying sob sad tears' },
  { emoji: '😨', keywords: 'fearful scared anxious' },
  { emoji: '😩', keywords: 'weary tired exhausted' },
  { emoji: '🤯', keywords: 'mind blown explode shocked wow' },
  { emoji: '😬', keywords: 'grimace nervous awkward' },
  { emoji: '😰', keywords: 'anxious sweat worried' },
  { emoji: '😱', keywords: 'scream scared horror shocked' },
  { emoji: '😠', keywords: 'angry mad' },
  { emoji: '😡', keywords: 'rage angry red mad furious' },
  { emoji: '🤬', keywords: 'cursing swearing angry furious' },
  { emoji: '😷', keywords: 'mask sick ill covid' },
  { emoji: '😇', keywords: 'angel halo good innocent' },
  { emoji: '🥳', keywords: 'party celebrate hat horn' },
  { emoji: '🤠', keywords: 'cowboy hat western' },
  { emoji: '🥺', keywords: 'pleading puppy eyes cute sad' },
  { emoji: '😻', keywords: 'heart eyes cat love' },
  { emoji: '🤓', keywords: 'nerd glasses smart' },
  { emoji: '👍', keywords: 'thumbs up like good approve yes' },
  { emoji: '👎', keywords: 'thumbs down dislike no bad' },
  { emoji: '👌', keywords: 'ok okay perfect' },
  { emoji: '🤌', keywords: 'chef kiss italian pinched fingers' },
  { emoji: '✌️', keywords: 'peace victory two' },
  { emoji: '🤞', keywords: 'crossed fingers luck hope' },
  { emoji: '🤟', keywords: 'love you hand' },
  { emoji: '🤘', keywords: 'rock horns metal sign' },
  { emoji: '🤙', keywords: 'call me shaka hang loose' },
  { emoji: '👈', keywords: 'point left direction' },
  { emoji: '👉', keywords: 'point right direction' },
  { emoji: '👆', keywords: 'point up direction' },
  { emoji: '👇', keywords: 'point down direction' },
  { emoji: '☝️', keywords: 'one point up index' },
  { emoji: '👋', keywords: 'wave hello bye hand' },
  { emoji: '🤚', keywords: 'raised back hand stop' },
  { emoji: '✋', keywords: 'raised hand stop high five' },
  { emoji: '👏', keywords: 'clap applause bravo' },
  { emoji: '🙌', keywords: 'raised hands celebrate hooray' },
  { emoji: '🤝', keywords: 'handshake deal agreement' },
  { emoji: '🙏', keywords: 'pray please thanks namaste' },
  { emoji: '💅', keywords: 'nail polish manicure sassy' },
  { emoji: '✍️', keywords: 'writing write pen hand' },
  { emoji: '💪', keywords: 'muscle strong flex arm' },
  { emoji: '🫶', keywords: 'heart hands love' },
  { emoji: '🫂', keywords: 'hug people embrace' },
  { emoji: '❤️', keywords: 'heart love red' },
  { emoji: '🧡', keywords: 'heart orange love' },
  { emoji: '💛', keywords: 'heart yellow love' },
  { emoji: '💚', keywords: 'heart green love' },
  { emoji: '💙', keywords: 'heart blue love' },
  { emoji: '💜', keywords: 'heart purple love' },
  { emoji: '🖤', keywords: 'heart black love dark' },
  { emoji: '🤍', keywords: 'heart white love' },
  { emoji: '🤎', keywords: 'heart brown love' },
  { emoji: '💔', keywords: 'broken heart sad heartbreak' },
  { emoji: '❣️', keywords: 'heart exclamation love' },
  { emoji: '💕', keywords: 'two hearts love' },
  { emoji: '💞', keywords: 'revolving hearts love spin' },
  { emoji: '💓', keywords: 'beating heart love pulse' },
  { emoji: '💗', keywords: 'growing heart love pink' },
  { emoji: '💖', keywords: 'sparkling heart love glitter' },
  { emoji: '💘', keywords: 'heart arrow cupid love' },
  { emoji: '💝', keywords: 'heart ribbon love gift' },
  { emoji: '🔥', keywords: 'fire hot flame lit' },
  { emoji: '💥', keywords: 'boom explosion clash' },
  { emoji: '✨', keywords: 'sparkles shine glitter stars' },
  { emoji: '⭐', keywords: 'star yellow' },
  { emoji: '🌟', keywords: 'glowing star bright' },
  { emoji: '💫', keywords: 'dizzy star spin' },
  { emoji: '🎉', keywords: 'party celebrate tada confetti' },
  { emoji: '🎊', keywords: 'confetti ball party celebrate' },
  { emoji: '🎈', keywords: 'balloon party red celebrate' },
  { emoji: '🎁', keywords: 'gift present wrapped birthday' },
  { emoji: '🏆', keywords: 'trophy winner first gold' },
  { emoji: '🥇', keywords: 'gold medal first winner' },
  { emoji: '💯', keywords: 'hundred percent perfect score' },
  { emoji: '🚀', keywords: 'rocket space launch fast' },
  { emoji: '⚡', keywords: 'lightning bolt electric fast zap' },
  { emoji: '🌈', keywords: 'rainbow colors pride' },
  { emoji: '☀️', keywords: 'sun sunny warm bright' },
  { emoji: '🌙', keywords: 'moon night crescent' },
  { emoji: '❄️', keywords: 'snowflake cold winter ice' },
  { emoji: '💎', keywords: 'diamond gem jewel blue' },
  { emoji: '👑', keywords: 'crown king queen royal' },
  { emoji: '🍕', keywords: 'pizza food slice' },
  { emoji: '🍔', keywords: 'burger hamburger food' },
  { emoji: '🌮', keywords: 'taco food mexican' },
  { emoji: '🍦', keywords: 'ice cream soft serve dessert' },
  { emoji: '🎂', keywords: 'birthday cake celebrate' },
  { emoji: '🥂', keywords: 'champagne cheers toast celebrate' },
  { emoji: '💤', keywords: 'sleep zzz tired rest' },
  { emoji: '💩', keywords: 'poop pile funny brown' },
  { emoji: '👻', keywords: 'ghost halloween spooky boo' },
  { emoji: '💀', keywords: 'skull dead death bones' },
  { emoji: '🤖', keywords: 'robot ai android machine' },
  { emoji: '👽', keywords: 'alien extraterrestrial ufo' },
  { emoji: '🐶', keywords: 'dog puppy pet' },
  { emoji: '🐱', keywords: 'cat kitten pet' },
  { emoji: '🐭', keywords: 'mouse animal' },
  { emoji: '🐹', keywords: 'hamster animal cute' },
  { emoji: '🐰', keywords: 'rabbit bunny easter' },
  { emoji: '🦊', keywords: 'fox animal' },
  { emoji: '🐻', keywords: 'bear animal' },
  { emoji: '🐼', keywords: 'panda bear animal' },
  { emoji: '🐨', keywords: 'koala bear animal' },
  { emoji: '🐯', keywords: 'tiger animal stripe' },
  { emoji: '🦁', keywords: 'lion animal king' },
  { emoji: '🐮', keywords: 'cow animal moo' },
  { emoji: '🐷', keywords: 'pig animal oink' },
  { emoji: '🐸', keywords: 'frog green animal' },
  { emoji: '🐵', keywords: 'monkey animal see no evil' },
  { emoji: '🦋', keywords: 'butterfly insect colorful' },
  { emoji: '🐝', keywords: 'bee honey insect' },
  { emoji: '🦜', keywords: 'parrot bird colorful' },
  { emoji: '🦄', keywords: 'unicorn magic rainbow horse' },
  { emoji: '🐉', keywords: 'dragon mythical fire' },
  { emoji: '🦈', keywords: 'shark fish ocean danger' },
  { emoji: '🐬', keywords: 'dolphin ocean sea smart' },
  { emoji: '🦧', keywords: 'orangutan ape monkey animal' },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  align?: 'left' | 'right';
}

export function EmojiPicker({ onSelect, onClose, align = 'left' }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  // Auto-focus search on open
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 60);
  }, []);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return SEARCH_INDEX.filter(({ emoji, keywords }) =>
      keywords.includes(q) || emoji === q
    ).map(r => r.emoji);
  }, [query]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className={cn('absolute bottom-full mb-3 w-72 bg-[var(--surface3)] border border-[var(--border2)] rounded-2xl shadow-2xl overflow-hidden z-30',
        align === 'right' ? 'right-0' : 'left-0')}
    >
      {/* Search bar */}
      <div className="p-2.5 border-b border-[var(--border)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--txt3)] pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search emoji…"
            className="w-full bg-[var(--surface4)] border border-[var(--border2)] rounded-lg py-1.5 pl-7 pr-7 text-xs text-[var(--txt)] placeholder-[var(--txt3)] focus:outline-none focus:border-cyan-700 transition-colors"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); searchRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--txt3)] hover:text-[var(--txt2)] transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Emoji grid */}
      <div className="h-60 overflow-y-auto p-2.5 space-y-3">
        {searchResults !== null ? (
          searchResults.length > 0 ? (
            <div>
              <div className="text-[10px] text-[var(--txt3)] font-semibold uppercase tracking-wider mb-1.5 px-1">
                Results for "{query}"
              </div>
              <div className="flex flex-wrap">
                {searchResults.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => onSelect(emoji)}
                    className="w-9 h-9 text-xl flex items-center justify-center rounded-lg hover:bg-[var(--surface4)] transition-colors"
                    aria-label={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--txt3)]">
              <span className="text-3xl">🔍</span>
              <p className="text-xs">No emoji found for "{query}"</p>
            </div>
          )
        ) : (
          CATEGORIES.map(cat => (
            <div key={cat.label}>
              <div className="text-[10px] text-[var(--txt3)] font-semibold uppercase tracking-wider mb-1.5 px-1">
                {cat.label}
              </div>
              <div className="flex flex-wrap">
                {cat.emojis.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => onSelect(emoji)}
                    className="w-9 h-9 text-xl flex items-center justify-center rounded-lg hover:bg-[var(--surface4)] transition-colors"
                    aria-label={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
