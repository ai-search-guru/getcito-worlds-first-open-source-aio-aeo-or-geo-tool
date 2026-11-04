/** Remove invitation secrets from the address bar after the form has read them. */
export function stripInviteParams(href: string): string | null {
  const url = new URL(href, 'https://placeholder.invalid');
  const params = url.searchParams;
  if (!params.has('invite') && !params.has('email')) return null;
  params.delete('invite');
  params.delete('email');
  const next = params.get('next');
  if (next && /\/invite\/[^/?#&]+/.test(next)) params.delete('next');
  return `${url.pathname}${url.search}${url.hash}`;
}
