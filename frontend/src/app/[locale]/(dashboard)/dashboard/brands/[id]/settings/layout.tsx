/**
 * Brand settings › Brand facts' server actions wait while the API reads the
 * brand's site (CE-047: a few pages, then the model, up to a minute), past a
 * page's default time on the platform. As the content editor's do.
 */
export const maxDuration = 300;

export default function BrandSettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
