import { Flag } from "effect/cli";

export const jsonFlag = (description = "Print JSON") =>
  Flag.Boolean("json").pipe(Flag.withDescription(description), Flag.withDefault(false));

export const switchFlag = (name: string, description: string) =>
  Flag.Boolean(name).pipe(Flag.withDescription(description), Flag.withDefault(false));

export const stringFlag = (name: string, metavar: string, description: string) =>
  Flag.String(name).pipe(Flag.withMetavar(metavar), Flag.withDescription(description), Flag.optional);

export const numberFlag = (name: string, description: string) =>
  Flag.Finite(name).pipe(Flag.withMetavar("n"), Flag.withDescription(description), Flag.optional);

export const apiUrlFlag = (description = "The htmlartifact server") => stringFlag("api-url", "url", description);
