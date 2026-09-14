import cloud from './cloud.config.json';

/** Shared choreographies (real-time collaboration) run on the account service: available wherever accounts are. */
export const COLLAB_ENABLED = Boolean(cloud.url && cloud.key);


/** Automatic detection of the dancers in the reference video (everything in src/detect). `false` removes it from the app. */
export const AUTO_DETECT_ENABLED = true;
