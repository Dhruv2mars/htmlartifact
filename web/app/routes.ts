import { type RouteConfig, index, route } from "@react-router/dev/routes";

// One route for every URL: the Worker picks the page (see page.ts).
export default [index("routes/page.tsx", { id: "index" }), route("*", "routes/page.tsx", { id: "splat" })] satisfies RouteConfig;
