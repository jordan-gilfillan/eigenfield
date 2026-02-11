import { Suspense } from 'react'
import StudioPage from './StudioClient'

export default function Page() {
  return (
    <Suspense>
      <StudioPage />
    </Suspense>
  )
}
