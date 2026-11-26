// A page of the admin console: its title, an optional line about it, and its content, beside the
// console's menu (in the layout). No school footer: this is Sessional's own console.
export function AdminShell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="page-title text-2xl">{title}</h1>
        {intro ? <p className="max-w-3xl text-sm">{intro}</p> : null}
      </header>
      {children}
    </div>
  );
}
