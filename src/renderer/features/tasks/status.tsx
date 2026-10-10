import { CircleCheck, CircleDashed, CircleDotDashed, MessageCircleWarning, type LucideIcon } from 'lucide-react'
import { TASK_STATUSES, type TaskStatus } from '../../../shared/types'

/** TaskItem.Status icon / title / tint. */
const STATUS_ICON: Record<TaskStatus, LucideIcon> = {
  backlog: CircleDashed, 'in progress': CircleDotDashed, 'needs review': MessageCircleWarning, done: CircleCheck
}
export const statusInfo = (st: TaskStatus) => TASK_STATUSES.find((x) => x.status === st)!

export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const Icon = STATUS_ICON[status]
  return <Icon size={size} strokeWidth={2.2} color={statusInfo(status).tint} style={{ flex: 'none' }} />
}
