/** A friend's initial on a colour of their own.
 *
 * The colour is hashed from the uid rather than the list position, so the
 * same person keeps the same chip while the list reorders around them (it is
 * sorted by today's progress, so it reorders constantly). The palette is
 * spread across hues and is independent of the colour theme: it tells people
 * apart, and four shades of the accent - which is what it used to be - don't.
 */
const PALETTE = ['#3d4a6b', '#3f5a4c', '#5a4636', '#553c56', '#3a5358', '#5a3c42'];

function colorFor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

interface AvatarProps {
  uid: string;
  name: string;
  /** Diameter in px. */
  size?: number;
  /** The signed-in user's own row, drawn in the accent instead. */
  isMe?: boolean;
}

export default function Avatar({ uid, name, size = 34, isMe }: AvatarProps) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: isMe ? 'var(--color-accent-700)' : colorFor(uid),
      }}
      className="flex-none rounded-full grid place-items-center font-medium text-text"
    >
      {isMe ? '·' : initialOf(name)}
    </span>
  );
}
