// The look plan in one place: six base values, two side colours and one accent. Every material and
// every CSS custom property in index.html names one of these, so the game has one palette and the
// lighting makes the shades it needs from it.
export const PALETTE = {
  canvas: '#171310',
  surface: '#4d463c',
  hairline: '#6b6153',
  floor: '#332d27',
  ink: '#ece5d8',
  muted: '#9a9082',
  accent: '#d8552f',
  raid: '#c8a03a',
  watch: '#4f8fbf',
};

// The floor and the map's dark trim, named so world.js does not guess a shade.
export const TONES = {
  floor: '#332d27',
  wall: '#4d463c',
  trim: '#6b6153',
  crate: '#7a6a4e',
};

// The two teams. A bot's colour is read from its side, never guessed from its model.
export const SIDES = {
  raid: { name: 'Raiders', colour: 'raid', tag: 'RAID' },
  watch: { name: 'Watch', colour: 'watch', tag: 'WATCH' },
};

export function other(side) {
  return side === 'raid' ? 'watch' : 'raid';
}
