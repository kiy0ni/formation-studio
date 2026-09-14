import cloud from './cloud.config.json';

/** Shared choreographies (real-time collaboration) run on the account service: available wherever accounts are. */
export const COLLAB_ENABLED = Boolean(cloud.url && cloud.key);

