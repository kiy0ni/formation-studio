export type ID = string;

export interface Vec {
  x: number;
  y: number;
}

/**
 * Coordinate system (meters): origin = stage center.
 * x > 0 = right side as seen from the audience.
 * y > 0 = downstage (towards the audience), y < 0 = upstage.
 */

export type PathKind = 'linear' | 'curve' | 'points';

export interface PathSpec {
  kind: PathKind;
  /** curve: 1 control point (quadratic bezier). points: waypoints (smoothed). */
  points: Vec[];
}

export interface Position extends Vec {
  /** How the dancer travels FROM the previous formation TO this one. */
  path?: PathSpec;
  /** Movement window inside the transition, as fractions [0..1]. */
  timing?: { start: number; end: number };
  comment?: string;
}

export interface Dancer {
  id: ID;
  name: string;
  color: string;
  order: number;
  group?: string;
}

export type Easing = 'linear' | 'ease' | 'easeIn' | 'easeOut';

export interface Formation {
  id: ID;
  name: string;
  order: number;
  /** Hold duration in seconds (formation stays still). */
  duration: number;
  /** Transition duration in seconds towards the NEXT formation. */
  transition: number;
  easing: Easing;
  note: string;
  positions: Record<ID, Position>;
  props: Record<ID, PropState>;
}

export type PropShape = 'rect' | 'ellipse';

export interface Prop {
  id: ID;
  name: string;
  shape: PropShape;
  order: number;
}

export interface PropState extends Vec {
  w: number;
  h: number;
  rotation: number;
  color: string;
  visible: boolean;
}

export interface StageSettings {
  width: number;
  depth: number;
  wingWidth: number;
  backstageDepth: number;
  gridStep: number;
  showGrid: boolean;
  showNumbers: boolean;
  snap: boolean;
  dancerSize: number;
  floorColor: string;
}

export interface MusicInfo {
  hash?: string;
  name?: string;
  duration?: number;
  bpm?: number;
  /** Time (s) of the first downbeat. */
  beatOffset?: number;
  /** Beats per count group (K-pop: 8 counts). */
  countsPerPhrase?: number;
}

export interface Choreo {
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  folderId?: ID | null;
  stage: StageSettings;
  music: MusicInfo;
  dancers: Record<ID, Dancer>;
  formations: Record<ID, Formation>;
  props: Record<ID, Prop>;
  collab?: CollabLink | null;
}

export interface CollabLink {
  roomId: string;
  key: string;
  role: 'edit' | 'view';
  /** Created the share: can remove people and change the links. */
  owner?: boolean;
  editKey?: string;
  viewKey?: string;
}

export interface TeamMember {
  name: string;
  color: string;
  group?: string;
}

export interface Team {
  id: ID;
  name: string;
  members: TeamMember[];
  updatedAt: number;
}

export interface Folder {
  id: ID;
  name: string;
  color: string;
  updatedAt?: number;
}

/** Evaluated state at a given time. */
export interface Frame {
  time: number;
  /** Index of the formation we're in or leaving. */
  index: number;
  /** 0 when holding, 0..1 during transition to index+1. */
  progress: number;
  inTransition: boolean;
  dancers: Record<ID, Vec>;
  props: Record<ID, PropState>;
}
