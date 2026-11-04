import { getExportBranding } from '@/lib/actions/whiteLabel';
import { fileWord, withFileWord } from './kit';

/**
 * White label on what a page downloads (00429): a CSV's, a sheet's or a
 * Word file's name starts with the agency's name instead of GetCito's
 * while the workspace's kit is in use, and a Word file names the agency as
 * its author. The kit is read once a page load, at the first download.
 */

type ExportBranding = { companyName: string | null } | null;

let branding: Promise<ExportBranding> | null = null;

/** The workspace's kit for its downloads; null without one in use. */
export function exportBranding(): Promise<ExportBranding> {
  branding ??= getExportBranding()
    .catch(() => ({ ok: false as const, failure: 'failed' as const }))
    .then((read) => {
      if (read.ok) return read.branding;
      // Not kept: the next download asks again. Meanwhile a name with
      // neither the agency's nor GetCito's word.
      branding = null;
      return { companyName: null };
    });
  return branding;
}

/** Forgets the kit read, after it changed (Settings › White label). */
export function forgetExportBranding() {
  branding = null;
}

/** The word a download's name starts with (fileWord): the agency's, GetCito's, or none. */
export async function exportFileWord(): Promise<string | null> {
  return fileWord(await exportBranding());
}

/** A download's name: `rest` after the agency's word, or GetCito's without a kit. */
export async function exportFileName(rest: string, separator = '_'): Promise<string> {
  return withFileWord(await exportFileWord(), rest, separator);
}

/** A Word file's author: the agency with a kit in use; none, as before, without one. */
export async function exportAuthor(): Promise<string | undefined> {
  return (await exportBranding())?.companyName ?? undefined;
}
