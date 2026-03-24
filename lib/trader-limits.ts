import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type DbClient = typeof prisma | Prisma.TransactionClient

export type TraderCapacitySnapshot = {
  id: string
  name: string
  locked: boolean
  maxCompanies: number | null
  maxUsers: number | null
  currentCompanies: number
  currentUsers: number
}

export function normalizeTraderLimitInput(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  // Treat empty/zero as "no limit" to avoid blocking all new records.
  if (value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return undefined
  if (parsed === 0) return null
  return parsed
}

export async function getTraderCapacitySnapshot(
  db: DbClient,
  traderId: string
): Promise<TraderCapacitySnapshot | null> {
  const trader = await db.trader.findFirst({
    where: {
      id: traderId,
      deletedAt: null
    },
    select: {
      id: true,
      name: true,
      locked: true,
      maxCompanies: true,
      maxUsers: true
    }
  })

  if (!trader) return null

  const [currentCompanies, currentUsers] = await Promise.all([
    db.company.count({
      where: {
        traderId,
        deletedAt: null
      }
    }),
    db.user.count({
      where: {
        traderId,
        deletedAt: null,
        NOT: [{ role: 'SUPER_ADMIN' }, { role: 'super_admin' }]
      }
    })
  ])

  return {
    ...trader,
    maxCompanies: trader.maxCompanies && trader.maxCompanies > 0 ? trader.maxCompanies : null,
    maxUsers: trader.maxUsers && trader.maxUsers > 0 ? trader.maxUsers : null,
    currentCompanies,
    currentUsers
  }
}
