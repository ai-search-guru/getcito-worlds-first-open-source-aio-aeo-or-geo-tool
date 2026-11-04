/**
 * The draft a member last opened in the editor, per brand: Content › Editor
 * goes back to it. Kept in this browser, as the editor's panel is; storage
 * unavailable (private mode) leaves none.
 */
const lastDraftKey = (brandId: string) => `aeo:content-last-draft:${brandId}`;

export function readLastDraft(brandId: string): string | null {
  try {
    return localStorage.getItem(lastDraftKey(brandId));
  } catch {
    return null;
  }
}

export function writeLastDraft(brandId: string, draftId: string): void {
  try {
    localStorage.setItem(lastDraftKey(brandId), draftId);
  } catch {
    // Not kept: Editor starts a new page instead.
  }
}

export function forgetLastDraft(brandId: string): void {
  try {
    localStorage.removeItem(lastDraftKey(brandId));
  } catch {
    // Nothing kept to forget.
  }
}
