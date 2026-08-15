import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

/**
 * Component props take their shapes from here rather than restating them, so a
 * change to a procedure's return type surfaces as a type error in the UI.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;
