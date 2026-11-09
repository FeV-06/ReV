# Material 3 Expressive implementation plan

Make it clear where someone is in a ReV handover, what they can do next, and what still needs review. Keep ReV’s green palette and serif display headings. Use larger shapes and stronger color on the entry screen and key actions, with quieter surfaces where people read evidence and edit claims.

This is a frontend change to the handover workspace. Use the existing React components and CSS, with the API and run contracts as the source of truth. The first milestone covers the import screen and progress indicator. The second carries the design through source selection, review, approval, and export.

## 1. Build the theme and restyle the entry screen

- Define CSS custom properties in [globals.css](../src/app/globals.css) for primary and on-primary colors, tonal containers and their text colors, neutral surfaces, outlines, and warning and error roles. Use ReV’s existing deep green as the starting point. Check each foreground/background pair before applying the tokens.
- Set a small type scale for the page headline, section headings, body, and labels. Keep the serif treatment for display text and use readable sans-serif text for controls and evidence. Start with 24–28 px for feature panels, 12–16 px for fields and insets, and fully rounded action buttons. Use spacing and tonal surfaces to separate groups.
- Give **Start a run** a mint surface, a filled **Import sources** button, and a quieter tonal **Try synthetic example** button. Keep form labels visible. Keep **Recent runs** and the review guidance in a quieter secondary column at wide widths and below the workflow on narrow screens.
- Replace the static progress display with an ordered list of four stages in [HandoverWorkspace.tsx](../src/components/HandoverWorkspace.tsx). Mark the active step with text and `aria-current="step"`. Fit the labels at narrow widths without horizontal scrolling.

| Run state | Stage or status to show |
| --- | --- |
| No active run or `importing` | **Import**. Show an importing message while the import request is pending. |
| `awaiting_scope_confirmation` | **Select sources**. Show a drafting message when generation starts. |
| `reconstructing` | **Select sources** with a drafting status until the draft is ready. |
| `needs_review` | **Review**. Keep review and approval within this stage. |
| `approved` | **Export** when the approved revision is eligible for download. If edits are pending, return the emphasis to review. |
| `failed` | Show an explicit failure status and the actions available for that run. Avoid marking a stage complete from the failure state alone. |

Use existing action eligibility to drive button emphasis and handle reopened runs and edits. If a pending request needs a specific message, track which action is in flight in the existing request flow. Keep loading and error messages visible and available to assistive technology.

**Milestone check.** Compare the empty workspace and the synthetic run on desktop and mobile. The primary action and current stage should be obvious in both, and reopening an existing run should show its actual stage.

## 2. Apply the system to source selection and review

- Give checked source rows a tinted background, keep the native checkboxes, and show the selected count beside the heading. Group authorization, partial-import warnings, and remote-processing confirmation near **Generate draft** so the reason for a disabled action is visible.
- Give every review item a consistent order for claim, verification status, evidence, and editing controls. Use text alongside status colors and a tonal inset for citations. Keep long evidence readable and allow long identifiers to wrap.
- Emphasize **Save review** when edits are pending, **Approve current revision** when approval is available, and **Download Markdown** when the approved revision can be exported. Reuse existing authorization, selection, revision, and disabled-state checks so styling follows the actions the user can actually take.
- Add brief transitions to selected rows and newly available stages. Keep focus visible and stable during updates. Use `prefers-reduced-motion` to suppress movement while preserving immediate visual feedback.

## 3. Verify and ship

1. Run `pnpm typecheck` and `pnpm build`.
2. Start the app with `pnpm dev` on port 3077 with `REV_DATA_DIR` set to a fresh temporary directory. Run `pnpm exec playwright test tests/browser.spec.ts tests/accessibility.spec.ts` against that server. Update selectors if presentation classes move while retaining the existing workflow assertions.
3. In the synthetic flow, check the visible stage after import, generation, approval, and reopening an approved run. Change the selected sources and confirm the UI returns to source selection and the previous export becomes unavailable. Edit an approved draft and confirm the UI points back to review.
4. Check the workspace at 320 px, 390 px, and desktop width. Verify no horizontal overflow, visible keyboard focus, readable contrast, accessible form and status labels, and reduced-motion behavior. Exercise a failed request and verify the UI gives a clear next action.
5. Capture desktop and mobile screenshots of the import and review states for the implementation PR. Use the import milestone to settle the palette, spacing, and shape choices before applying them across review.

## References

- [Material Design 3](https://m3.material.io/)
- [Material 3 typography roles](https://m3.material.io/styles/typography/applying-type)
- [Material 3 motion guidance](https://m3.material.io/styles/motion)
- [Google’s research on Material 3 Expressive](https://design.google/library/expressive-material-design-google-research)
