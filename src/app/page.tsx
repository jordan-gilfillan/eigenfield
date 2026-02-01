import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">Journal Distiller</h1>
      <p className="text-gray-600 mb-8 text-center max-w-lg">
        Convert AI conversation exports into auditable, reproducible curated
        datasets.
      </p>

      <div className="flex gap-4">
        <Link
          href="/distill/import"
          className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700"
        >
          Import Conversations
        </Link>
        <Link
          href="/distill"
          className="px-6 py-3 bg-gray-200 text-gray-800 font-medium rounded-md hover:bg-gray-300"
        >
          Dashboard
        </Link>
      </div>
    </main>
  )
}
