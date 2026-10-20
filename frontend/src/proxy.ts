import { NextResponse, type NextRequest } from "next/server";

// Runs before every page (see `matcher`): no auth cookie -> go to /login.
// This is only a fast first check; Django still verifies the token on every API call.
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("access_token") || request.cookies.has("refresh_token");
  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Every page except /login, Next.js internals (_next) and files like /logo.png.
  matcher: ["/((?!login|_next|.*\\..*).*)"],
};
