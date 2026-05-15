export async function resolveThreadRootPostId(supabase, postId, parentId) {
  let id = postId;
  let parent = parentId;
  for (let i = 0; i < 50; i++) {
    if (!parent) return id;
    id = parent;
    const { data, error } = await supabase.from("posts").select("parent_id").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return id;
    parent = data.parent_id;
  }
  return id;
}

export async function resolveThreadReplyToAnchorPostId(supabase, threadRootId, source) {
  let curId = source.id;
  let curReply = source.reply_to_post_id;
  if (curReply === undefined) {
    const { data, error } = await supabase
      .from("posts")
      .select("reply_to_post_id")
      .eq("id", curId)
      .maybeSingle();
    if (error) throw error;
    curReply = data?.reply_to_post_id ?? null;
  }

  for (let hops = 0; hops < 50; hops++) {
    if (curReply == null || curReply === threadRootId) return curId;
    const { data, error } = await supabase
      .from("posts")
      .select("id, reply_to_post_id")
      .eq("id", curReply)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`resolveThreadReplyToAnchorPostId: missing post ${curReply}`);
    curId = data.id;
    curReply = data.reply_to_post_id ?? null;
  }
  throw new Error("resolveThreadReplyToAnchorPostId: hop limit exceeded");
}
