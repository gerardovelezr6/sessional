// The steps of "How a session runs", shared by the page (server) and the scroll story (browser).
export const STORY_STEPS = ['rollcall', 'speakers', 'motions', 'documents', 'voting', 'after'] as const;
export type StoryStep = (typeof STORY_STEPS)[number];
