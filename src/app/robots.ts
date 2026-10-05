import type { MetadataRoute } from "next";
import { signupEnabled } from "@/lib/features";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/$", "/login", ...(signupEnabled() ? ["/register"] : [])], disallow: ["/app", "/invoice", "/invite", "/api", "/workspaces"] },
  };
}
