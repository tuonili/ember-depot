// The map: Ember Depot. A freight yard cut into two bomb sites, a mid lane between them and two
// long flanks, built from boxes only, so every collider is an AABB and every sightline is one the
// layout asks for. This file is data: the walls, the props, the two sites, the spawns, and the
// waypoint graph the bots route over. world.js turns it into meshes; bots.js walks the graph.
//
//            z = -16  (north)  Watch spawn
//   +--------+----------------+--------+
//   | Site A |    north wall  | Site B |
//   |        |                |        |
//   +--- ----+----------------+---- ---+
//   |  long  |      mid       | tunnel |
//   |        |                |        |
//   +--------+----------------+--------+
//            z = +16  (south)  Raiders spawn

export const BOUNDS = { minX: -20, maxX: 20, minZ: -16, maxZ: 16 };

export const SITES = [
  { id: 'A', x: -12, z: -9, radius: 3.6, label: 'Site A' },
  { id: 'B', x: 12, z: -9, radius: 3.6, label: 'Site B' },
];

export const SPAWNS = {
  raid: [{ x: 0, z: 14.2 }, { x: -3.2, z: 14.6 }, { x: 3.2, z: 14.6 }, { x: -1.6, z: 12.6 }, { x: 1.6, z: 12.6 }],
  watch: [{ x: 0, z: -14.2 }, { x: -2.8, z: -13.6 }, { x: 2.8, z: -13.6 }, { x: -1.4, z: -15 }, { x: 1.4, z: -15 }],
};

// Every wall is {x, z, w, d, h, mat}: a box centred at x, z with width w (x), depth d (z), height h.
// Walls reach 3.6 m, cover reaches 1.05 m (crouch-behind) or 1.75 m (stand-behind, blocks sight).
export const WALLS = [
  // The outer shell.
  { x: 0, z: -16.6, w: 41.2, d: 1.2, h: 4.2, mat: 'surface' },
  { x: 0, z: 16.6, w: 41.2, d: 1.2, h: 4.2, mat: 'surface' },
  { x: -20.6, z: 0, w: 1.2, d: 33, h: 4.2, mat: 'surface' },
  { x: 20.6, z: 0, w: 1.2, d: 33, h: 4.2, mat: 'surface' },

  // Site dividers: two long walls running south from the north wall, so each site is its own room.
  { x: -4, z: -10, w: 0.9, d: 12.4, h: 3.6, mat: 'hairline' },
  { x: 4, z: -10, w: 0.9, d: 12.4, h: 3.6, mat: 'hairline' },

  // Each site's south wall, with one doorway into the mid lane.
  { x: -14.2, z: -4.2, w: 11, d: 0.9, h: 3.6, mat: 'hairline' },
  { x: 14.2, z: -4.2, w: 11, d: 0.9, h: 3.6, mat: 'hairline' },

  // Short walls inside the site doorways, so entering is a corner and not a straight run.
  { x: -9.4, z: -2.2, w: 0.9, d: 3.2, h: 3.2, mat: 'hairline' },
  { x: 9.4, z: -2.2, w: 0.9, d: 3.2, h: 3.2, mat: 'hairline' },

  // West and east flanks: buildings that make the long lanes one wall wide.
  { x: -16.8, z: 3.2, w: 6.6, d: 0.9, h: 3.6, mat: 'hairline' },
  { x: 16.8, z: 3.2, w: 6.6, d: 0.9, h: 3.6, mat: 'hairline' },
  { x: -14.2, z: 7.4, w: 0.9, d: 8.4, h: 3.6, mat: 'hairline' },
  { x: 14.2, z: 7.4, w: 0.9, d: 8.4, h: 3.6, mat: 'hairline' },

  // The raider spawn pocket: two stubs, open to the middle.
  { x: -6.4, z: 12.6, w: 0.9, d: 6.8, h: 3.2, mat: 'hairline' },
  { x: 6.4, z: 12.6, w: 0.9, d: 6.8, h: 3.2, mat: 'hairline' },

  // Mid lane shoulders: cover that splits the mid into three approach lines.
  { x: -7.2, z: 1.6, w: 5.2, d: 0.9, h: 3.2, mat: 'hairline' },
  { x: 7.2, z: 1.6, w: 5.2, d: 0.9, h: 3.2, mat: 'hairline' },
];

// Props: crates, barriers and the two silo drums. Same shape, different heights and colours, and
// each one is cover a player can read at a glance.
export const PROPS = [
  // Site A cover.
  { x: -12.6, z: -11.4, w: 1.7, d: 1.7, h: 1.05, mat: 'crate' },
  { x: -8.6, z: -12.2, w: 1.7, d: 1.7, h: 1.75, mat: 'crate' },
  { x: -15.8, z: -6.8, w: 2.6, d: 1.1, h: 1.05, mat: 'hairline' },
  { x: -6.2, z: -8.2, w: 1.1, d: 2.6, h: 1.75, mat: 'crate' },
  // Site B cover.
  { x: 12.6, z: -11.4, w: 1.7, d: 1.7, h: 1.05, mat: 'crate' },
  { x: 8.6, z: -12.2, w: 1.7, d: 1.7, h: 1.75, mat: 'crate' },
  { x: 15.8, z: -6.8, w: 2.6, d: 1.1, h: 1.05, mat: 'hairline' },
  { x: 6.2, z: -8.2, w: 1.1, d: 2.6, h: 1.75, mat: 'crate' },
  // Mid lane cover, staggered so neither side owns the corridor.
  { x: -1.8, z: 6.4, w: 1.5, d: 1.5, h: 1.05, mat: 'crate' },
  { x: 2.2, z: 3.6, w: 1.5, d: 1.5, h: 1.05, mat: 'crate' },
  { x: -2.4, z: 0.6, w: 1.5, d: 1.5, h: 1.75, mat: 'crate' },
  { x: 0.4, z: 10.2, w: 2.2, d: 1.1, h: 1.05, mat: 'hairline' },
  // Flank cover.
  { x: -18.2, z: 0.4, w: 1.4, d: 1.4, h: 1.05, mat: 'crate' },
  { x: 18.2, z: 0.4, w: 1.4, d: 1.4, h: 1.05, mat: 'crate' },
  { x: -17.6, z: 9.8, w: 1.4, d: 1.4, h: 1.75, mat: 'crate' },
  { x: 17.6, z: 9.8, w: 1.4, d: 1.4, h: 1.75, mat: 'crate' },
  // Spawn-side barriers.
  { x: -3.4, z: 11.2, w: 1.3, d: 1.3, h: 1.05, mat: 'crate' },
  { x: 3.4, z: 11.2, w: 1.3, d: 1.3, h: 1.05, mat: 'crate' },
];

// The two silo drums: cylinders are boxes here, so the map has one collider shape.
export const SITE_DRUMS = [
  { x: -12, z: -9, w: 1.2, d: 1.2, h: 0.9, mat: 'accent' },
  { x: 12, z: -9, w: 1.2, d: 1.2, h: 0.9, mat: 'accent' },
];

// The bots' waypoint graph. A route is a list of node ids; a bot walks one node at a time and
// turns corners at the nodes, which is what makes a flank read as a route and not a straight line.
// Edges are listed once per pair and used both ways.
export const WAYPOINTS = [
  { id: 'rs', x: 0, z: 13.6 },
  { id: 'rsW', x: -4.4, z: 12.2 },
  { id: 'rsE', x: 4.4, z: 12.2 },
  { id: 'midS', x: 0, z: 8.6 },
  { id: 'midC', x: 0, z: 4.6 },
  { id: 'midW', x: -4.6, z: 4.6 },
  { id: 'midE', x: 4.6, z: 4.6 },
  { id: 'midN', x: 0, z: -0.6 },
  { id: 'aDoor', x: -6.8, z: -3.4 },
  { id: 'aIn', x: -8.4, z: -6.6 },
  { id: 'aSite', x: -12, z: -8.6 },
  { id: 'aBack', x: -16.4, z: -11.6 },
  { id: 'aCorner', x: -17, z: -6.2 },
  { id: 'bDoor', x: 6.8, z: -3.4 },
  { id: 'bIn', x: 8.4, z: -6.6 },
  { id: 'bSite', x: 12, z: -8.6 },
  { id: 'bBack', x: 16.4, z: -11.6 },
  { id: 'bCorner', x: 17, z: -6.2 },
  { id: 'longW', x: -18.4, z: 6.2 },
  { id: 'longWn', x: -18.4, z: 2.4 },
  { id: 'longWs', x: -18.4, z: 10.6 },
  { id: 'tunnelE', x: 18.4, z: 6.2 },
  { id: 'tunnelEn', x: 18.4, z: 2.4 },
  { id: 'tunnelEs', x: 18.4, z: 10.6 },
  { id: 'ws', x: 0, z: -13.8 },
  { id: 'wsW', x: -2.6, z: -12.4 },
  { id: 'wsE', x: 2.6, z: -12.4 },
  { id: 'midNw', x: -2.2, z: -8.4 },
  { id: 'midNe', x: 2.2, z: -8.4 },
];

export const EDGES = [
  ['rs', 'rsW'], ['rs', 'rsE'], ['rs', 'midS'],
  ['rsW', 'longWs'], ['rsE', 'tunnelEs'],
  ['midS', 'midC'], ['midS', 'midW'], ['midS', 'midE'],
  ['midC', 'midW'], ['midC', 'midE'], ['midC', 'midN'],
  ['midW', 'aDoor'], ['midE', 'bDoor'],
  ['midN', 'midNw'], ['midN', 'midNe'],
  ['longWs', 'longW'], ['longW', 'longWn'], ['longWn', 'aCorner'],
  ['tunnelEs', 'tunnelE'], ['tunnelE', 'tunnelEn'], ['tunnelEn', 'bCorner'],
  ['aDoor', 'aIn'], ['aIn', 'aSite'], ['aSite', 'aBack'], ['aSite', 'aCorner'],
  ['bDoor', 'bIn'], ['bIn', 'bSite'], ['bSite', 'bBack'], ['bSite', 'bCorner'],
  ['midNw', 'aIn'], ['midNe', 'bIn'],
  ['ws', 'wsW'], ['ws', 'wsE'], ['wsW', 'aBack'], ['wsE', 'bBack'],
  ['wsW', 'aCorner'], ['wsE', 'bCorner'],
  // The long way round: the flanks also reach the spawn pocket.
  ['longWs', 'midW'], ['tunnelEs', 'midE'],
  ['longWn', 'aIn'], ['tunnelEn', 'bIn'],
];

// Hand-authored routes, so a bot's push has a shape: a route per site per lane, plus the two
// rotations a defending bot makes when it hears the other site.
export const ROUTES = {
  'mid-to-a': ['rs', 'midS', 'midC', 'midW', 'aDoor', 'aIn', 'aSite'],
  'mid-to-b': ['rs', 'midS', 'midC', 'midE', 'bDoor', 'bIn', 'bSite'],
  'long-to-a': ['rs', 'rsW', 'longWs', 'longW', 'longWn', 'aCorner', 'aSite'],
  'tunnel-to-b': ['rs', 'rsE', 'tunnelEs', 'tunnelE', 'tunnelEn', 'bCorner', 'bSite'],
  'mid-to-north': ['rs', 'midS', 'midC', 'midN', 'midNw', 'aIn', 'aSite'],
  'rotate-a-to-b': ['aSite', 'aCorner', 'longWn', 'longW', 'longWs', 'midW', 'midC', 'midE', 'bDoor', 'bIn', 'bSite'],
  'rotate-b-to-a': ['bSite', 'bCorner', 'tunnelEn', 'tunnelE', 'tunnelEs', 'midE', 'midC', 'midW', 'aDoor', 'aIn', 'aSite'],
  'defend-a': ['ws', 'wsW', 'aCorner', 'aSite'],
  'defend-b': ['ws', 'wsE', 'bCorner', 'bSite'],
  'defend-mid': ['ws', 'wsW', 'midNw', 'midN', 'midC'],
};

// Where a bot stops on a route to hold an angle, by site.
export const HOLD_SPOTS = {
  A: [{ x: -14.6, z: -7.4, look: 0.5 }, { x: -10.2, z: -12.6, look: 2.6 }, { x: -6.8, z: -5.6, look: 1.4 }],
  B: [{ x: 14.6, z: -7.4, look: -0.5 }, { x: 10.2, z: -12.6, look: -2.6 }, { x: 6.8, z: -5.6, look: -1.4 }],
  MID: [{ x: -3.4, z: 1.2, look: 0.2 }, { x: 3.4, z: 1.2, look: -0.2 }],
};
