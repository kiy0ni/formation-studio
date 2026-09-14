import { recenter } from '../../lib/presets';
import type { Vec } from '../../lib/types';

export { r2 } from '../../lib/geometry';

export const recenterSafe = (pts: Vec[]): Vec[] => (pts.length ? recenter(pts) : [{ x: 0, y: 0 }]);
