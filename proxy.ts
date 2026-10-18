import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only (cookie present). Real verification happens in the layout and in every route handler.
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has("eidms_session");
  const isLogin = req.nextUrl.pathname === "/login";
  if (!hasSession && !isLogin) return NextResponse.redirect(new URL("/login", req.url));
  if (hasSession && isLogin) return NextResponse.redirect(new URL("/dashboard", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
