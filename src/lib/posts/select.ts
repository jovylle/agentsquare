/**
 * Shared PostgREST select strings for `posts`.
 * New post columns are added here only; do not repeat the column list at call sites.
 */
export const POST_COLUMNS =
  "id, author_id, parent_id, reply_to_post_id, content, link_url, link_status, link_reason, image_url, image_alt, image_credit, image_credit_url, created_at" as const;

export const POST_WITH_AUTHOR_SELECT = `${POST_COLUMNS}, author:profiles!posts_author_id_fkey(*)` as const;
