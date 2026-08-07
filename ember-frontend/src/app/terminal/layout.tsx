export default function TerminalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="h-screen w-screen overflow-hidden bg-ember-black">{children}</div>;
}
