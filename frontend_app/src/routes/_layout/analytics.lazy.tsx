import { createLazyFileRoute } from '@tanstack/react-router'
import AnalyticsDashboard from '@/components/analytics/AnalyticsDashboard'
// Debug dashboard no longer needed - authentication issue fixed
// import DebugAnalyticsDashboard from '@/components/analytics/DebugAnalyticsDashboard'
import { BarChart3 } from 'lucide-react'

export const Route = createLazyFileRoute('/_layout/analytics')({
  component: AnalyticsPage,
})

function AnalyticsPage() {
  return (
    <div className="space-y-4 p-4 pt-6 md:p-8">
      <nav
        className="flex items-center text-sm text-muted-foreground mb-1"
        aria-label="Breadcrumb"
      >
        <a href="/home" className="hover:underline">Home</a>
        <span className="mx-2">&gt;</span>
        <span className="font-semibold">Analytics</span>
      </nav>
      <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <BarChart3 className="h-5 w-5" />
        Analytics
      </h2>
      <p className="text-muted-foreground text-sm">
        System performance and usage metrics
      </p>

      {/* Analytics dashboard content */}
      <AnalyticsDashboard />
    </div>
  )
}
