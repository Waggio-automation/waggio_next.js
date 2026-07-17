# Design system plan

## Foundations

- Use semantic tokens rather than raw gray/emerald/red classes: canvas, surface, text, muted, border, action, focus, info, success, warning, danger, and disabled.
- Ship one fully accessible light theme first; remove the automatic partial dark theme until every component supports it.
- Use Geist consistently (or deliberately choose the existing Arial direction), with documented type steps and tabular numerals for money.
- Adopt spacing on a 4px base, 8-12px control gaps, and fewer radii: 8 control, 12 container, 20 feature card.
- Meet WCAG 2.2 AA contrast and visible focus. Status never relies on color alone.

## Shared primitives

Button/link-button, input/select/textarea/date/money, field/fieldset/help/error, alert/banner, status badge, card, page header, stepper, dialog/confirmation, drawer, table/data grid, mobile data cards, description list, tabs, empty/skeleton/error state, toast/live region, pagination/filter bar, money/totals summary, audit timeline, and sensitive-value reveal control.

Primitives encode loading/disabled/invalid/focus-visible semantics and prevent action duplication. Financial confirmation is a dedicated domain component, not a generic browser confirm.

## Content and terminology

- “Payroll draft,” “Review payroll,” “Approve and finalize,” “Employee transfers,” and “Pay statements” replace the ambiguous single “Create Paystub.”
- Label source ownership: “Calculated by Waggio,” “Waiting for employer funding,” “Reported by payment provider,” “Recorded manually as paid to CRA.”
- Errors state what happened, what was not changed, and the safe next step. Provider codes remain in expandable technical details/support references.

## Accessibility acceptance

Keyboard order and escape behavior; labelled dialog and focus trap/return; error summary focuses and links fields; `aria-live` only for meaningful async changes; semantic tables with captions/headers; charts have tabular alternatives; 200% zoom/reflow; reduced motion; localized dates with machine-readable values; money/currency always explicit; full functionality without hover.

## Governance

Document components in an isolated catalogue, add visual/accessibility tests, prohibit new raw colors/radii when a token exists, require content review for payroll terms, and version breaking component changes. Design tokens do not encode payroll business status transitions; they only render domain states supplied by the backend.
