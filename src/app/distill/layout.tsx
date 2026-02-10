'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/distill/studio', label: 'Studio' },
  { href: '/distill', label: 'Dashboard' },
  { href: '/distill/import', label: 'Import' },
  { href: '/distill/import/inspect', label: 'Inspector' },
  { href: '/distill/search', label: 'Search' },
]

function getActiveHref(pathname: string): string {
  // Match most specific path first
  if (pathname.startsWith('/distill/studio')) return '/distill/studio'
  if (pathname.startsWith('/distill/import/inspect')) return '/distill/import/inspect'
  if (pathname.startsWith('/distill/import')) return '/distill/import'
  if (pathname.startsWith('/distill/search')) return '/distill/search'
  // Dashboard is default (covers /distill and /distill/runs/...)
  return '/distill'
}

export default function DistillLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const activeHref = getActiveHref(pathname)

  return (
    <>
      <nav className="border-b border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-8 flex items-center h-12">
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-600 mr-6"
          >
            Home
          </Link>
          <div className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = activeHref === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    isActive
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      </nav>
      {children}
    </>
  )
}
