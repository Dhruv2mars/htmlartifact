import { AppShell } from "../components/AppShell";
import { ButtonLink } from "../components/Button";
import { Field } from "../components/Field";
import { AlertIcon, ArrowLeft } from "../components/icons";
import { Rule } from "../components/Sheet";
import { Submit } from "../components/Submit";
import type { Confirmation, Session } from "../page";

// A change that ends something (a role, a membership, a workspace) gets its
// own page first: what will happen, from live counts, then one button. When
// it can't happen now (the last admin leaving), the page says why instead.
export function Confirm({ session, section, confirm }: { session: Session; section: "people" | "settings"; confirm: Confirmation }) {
  return (
    <AppShell session={session} section={section}>
      <Rule width="app" inner="px-4 py-3 sm:px-5">
        <a href={confirm.back.href} className="inline-flex items-center gap-1.5 rounded-chip text-[13.5px] text-muted transition-colors duration-150 hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          {confirm.back.label}
        </a>
      </Rule>
      <Rule width="app" inner="px-4 pb-8 pt-8 sm:px-5 sm:pt-12">
        <div className="max-w-[40rem]">
          <h1 className="text-balance text-[24px] font-medium leading-[1.15] tracking-[-0.03em] text-foreground [overflow-wrap:anywhere] sm:text-[28px]">
            {confirm.title}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted [overflow-wrap:anywhere]">{confirm.lead}</p>
          {confirm.points.length > 0 && (
            <ul className="mt-5 divide-y divide-line border-y border-line">
              {confirm.points.map((point) => (
                <li key={point} className="flex gap-3 py-2.5 text-[14.5px] leading-relaxed text-foreground [overflow-wrap:anywhere]">
                  <span aria-hidden className="mt-[0.7em] h-px w-2.5 shrink-0 bg-faint" />
                  {point}
                </li>
              ))}
            </ul>
          )}

          {confirm.blocked ? (
            <>
              <p className="mt-6 flex items-start gap-2.5 rounded-control border border-border bg-surface/70 px-3.5 py-3 text-[14px] leading-relaxed text-foreground">
                <AlertIcon className="mt-0.5 size-4 shrink-0 text-muted" />
                {confirm.blocked}
              </p>
              <ButtonLink href={confirm.back.href} tone="line" className="mt-5">
                {confirm.back.label}
              </ButtonLink>
            </>
          ) : (
            <form method="post" action={confirm.action} className="mt-7">
              {Object.entries(confirm.fields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              {confirm.type && (
                <Field
                  label="To confirm, type the workspace name"
                  hint={
                    <>
                      Exactly as shown: <span className="font-mono text-[12.5px] text-foreground [overflow-wrap:anywhere]">{confirm.type}</span>
                    </>
                  }
                  name="confirm"
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  // Until it matches, the browser holds the form and says why;
                  // the server checks the name again either way.
                  onChange={(e) => e.currentTarget.setCustomValidity(e.currentTarget.value === confirm.type ? "" : "Type the workspace name exactly as shown.")}
                  className="mb-5 max-w-[28rem]"
                />
              )}
              <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center">
                <ButtonLink href={confirm.back.href} tone="line" className="w-full sm:w-auto">
                  Cancel
                </ButtonLink>
                <Submit tone={confirm.tone === "danger" ? "danger" : "ink"} pending="Working…" className="w-full sm:w-auto">
                  {confirm.submit}
                </Submit>
              </div>
            </form>
          )}
        </div>
      </Rule>
      <div aria-hidden className="mx-auto w-full max-w-[1040px] flex-1 border-x border-line" />
    </AppShell>
  );
}
