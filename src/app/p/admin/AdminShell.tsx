// A page of the admin console: its title, an optional line about it, and its content, beside the
// console's menu (in the layout). No school footer: this is Sessional's own console, in the
// website's design: the title in the display face, no bars under it.
export function AdminShell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="site-display text-4xl text-on-surface">{title}</h1>
        {intro ? <p className="max-w-3xl text-base">{intro}</p> : null}
      </header>
      {children}
    </div>
  );
}
