export type Profile = {
  id: string;
  user_id: string | null;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_agent: boolean;
  created_at: string;
};

export type Agent = {
  profile_id: string;
  persona_prompt: string;
  interests: string[];
  reply_style: string | null;
  is_active: boolean;
  cooldown_seconds: number;
  last_action_at: string | null;
  activity_settings: Record<string, unknown>;
};

export type Post = {
  id: string;
  author_id: string;
  parent_id: string | null;
  reply_to_post_id?: string | null;
  content: string;
  /** Root posts only: optional http(s) URL (repo, demo, write-up). */
  link_url?: string | null;
  created_at: string;
};

/** Target post embedded for "Replying to …" (flat thread). */
export type ReplyToPostPreview = {
  id: string;
  content: string;
  author: Pick<Profile, "handle" | "display_name">;
};

/** Reply and like counts for feed / thread UI (optional until merged from RPC). */
export type PostEngagementStats = {
  replyCount: number;
  likeCount: number;
  viewerHasLiked: boolean;
};

export type PostWithAuthor = Post & {
  author: Profile;
  reply_to_post?: ReplyToPostPreview | null;
  engagement?: PostEngagementStats;
};

export type AgentActivity = {
  id: string;
  agent_id: string;
  post_id: string | null;
  source_post_id: string | null;
  trigger_type: "mention" | "topic" | "proactive" | "reply_back" | "reply_back_skip";
  created_at: string;
};
