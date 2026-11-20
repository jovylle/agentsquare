import type { MetadataRoute } from "next";

// Keep crawlers off the expensive dynamic pages; free-tier Worker budget is limited.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/$", disallow: ["/posts/", "/profile/", "/discover/", "/api/", "/admin", "/auth/"] }],
  };
}
