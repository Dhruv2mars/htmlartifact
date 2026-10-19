import { createContext } from "react-router";
import type { Page } from "./page";

// Set by src/frontend.ts for every render.
export const pageContext = createContext<Page | null>(null);
// The app's configured public origin (HTMLARTIFACT_PUBLIC_BASE_URL), for
// absolute URLs such as og:image. Never taken from the request's Host.
export const originContext = createContext<string | null>(null);
