/**
 * The editor's server actions wait on the Content Agent: Fix open rules
 * answers once the model has (contentAgent.js, up to 60 s), past a page's
 * default time on the platform. As the API proxy's long routes do.
 */
export const maxDuration = 300;

export default function ContentEditorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
