import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, type LinksFunction } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { originContext, pageContext } from "./context";
import type { Page } from "./page";

export const links: LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }
];

// The page, plus this deployment's origin for absolute social-preview URLs.
export async function loader({ context, request }: Route.LoaderArgs): Promise<Page & { origin: string }> {
  const page = context.get(pageContext);
  if (page) return { ...page, origin: context.get(originContext) ?? "" };
  const origin = new URL(request.url).origin;
  if (import.meta.env.DEV) {
    const { fixturePage } = await import("./fixtures");
    return { ...fixturePage(new URL(request.url)), origin };
  }
  throw new Response("Not found", { status: 404 });
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#f5f6f8" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0b1020" media="(prefers-color-scheme: dark)" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
