// Each auth page renders its own frame (AuthShell), since the header's
// button points at a different page on each.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
