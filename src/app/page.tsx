import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-16">
        <div className="rounded-3xl border border-gray-200 bg-white px-8 py-10 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
            Journal Distiller
          </p>
          <h1 className="mt-3 max-w-4xl text-5xl font-semibold tracking-tight text-gray-900">
            Guided first. Advanced tooling still available when you need it.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-gray-600">
            Convert AI conversation exports into auditable, reproducible curated datasets with a guided demo flow or the full advanced distill workspace.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-blue-100 bg-blue-50 px-8 py-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
              Guided
            </p>
            <h2 className="mt-3 text-3xl font-semibold text-gray-900">Start with `/demo`</h2>
            <p className="mt-3 text-base text-gray-600">
              Import, classify, summarize, and export in a single explicit foreground flow with dry-run defaults.
            </p>
            <Link
              href="/demo"
              className="mt-6 inline-flex rounded-full bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
            >
              Open guided demo
            </Link>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white px-8 py-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">
              Advanced
            </p>
            <h2 className="mt-3 text-3xl font-semibold text-gray-900">Use `/distill/*` directly</h2>
            <p className="mt-3 text-base text-gray-600">
              Jump straight into dashboard, studio, inspector, and search when you want the power-user surfaces.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/distill"
                className="inline-flex rounded-full border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-gray-400"
              >
                Open advanced dashboard
              </Link>
              <Link
                href="/distill/import"
                className="inline-flex rounded-full border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-gray-400"
              >
                Import directly
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
