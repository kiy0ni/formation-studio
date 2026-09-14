import cloud from './cloud.config.json';

/** Shared choreographies (real-time collaboration) run on the account service: available wherever accounts are. */
export const COLLAB_ENABLED = Boolean(cloud.url && cloud.key);

/** Reference video (watch a dance practice beside the stage, export both). false = feature hidden, data kept. */
export const VIDEO_REFERENCE_ENABLED = true;
